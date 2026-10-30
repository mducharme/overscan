#!/usr/bin/env node
/**
 * Studio smoke test: serves example files with `overscan dev --no-open`, loads each in headless Chrome
 * (DevTools protocol), and fails on console errors or uncaught exceptions. When the studio exposes
 * `window.__overscanStudio` (its store), scenario checks also assert on its state.
 * Requires `pnpm build` and Chrome (or CHROME_PATH). Screenshots go to bench-results/studio-smoke/.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const OUT = join(ROOT, 'bench-results', 'studio-smoke')
const CLI = join(ROOT, 'packages', 'cli', 'dist', 'cli.js')
const sleep = ms => new Promise(r => setTimeout(r, ms))

const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find(p => p && existsSync(p))

/** Each scenario serves one file; `checks` run in the page once the studio store reports ready. */
const SCENARIOS = [
  {
    name: 'scene',
    file: 'examples/generators/plasma.scene.json',
    checks: [
      ['loads', 's => s.status === "ready"'],
      ['one section', 's => s.document.player.sections.length === 1'],
    ],
  },
  {
    name: 'demo',
    file: 'examples/showcase.demo.json',
    checks: [
      ['loads', 's => s.status === "ready"'],
      ['all sections', 's => s.document.player.sections.length === 16'],
      ['no asset problems', 's => s.document.assetProblems.length === 0'],
    ],
  },
]

async function startDevServer(file) {
  const proc = spawn(process.execPath, [CLI, 'dev', file, '--no-open'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  proc.stdout.on('data', d => { output += d })
  proc.stderr.on('data', d => { output += d })
  for (let i = 0; i < 100; i++) {
    const m = output.match(/http:\/\/localhost:(\d+)/)
    if (m) return { proc, url: `http://localhost:${m[1]}/` }
    await sleep(100)
  }
  proc.kill()
  throw new Error(`dev server did not start:\n${output}`)
}

async function withChrome(fn) {
  const port = 9300 + Math.floor(Math.random() * 500)
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'studio-smoke-'))}`, 'about:blank'], { stdio: 'ignore' })
  try {
    let wsUrl
    for (let i = 0; i < 50 && !wsUrl; i++) {
      await sleep(200)
      try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page')?.webSocketDebuggerUrl } catch {}
    }
    if (!wsUrl) throw new Error('Chrome DevTools endpoint did not come up')
    const ws = new WebSocket(wsUrl)
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
    let id = 0
    const pending = new Map()
    const problems = []
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data)
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push(`console.error: ${m.params.args.map(a => a.value ?? a.description).join(' ')}`)
      if (m.method === 'Runtime.exceptionThrown') problems.push(`exception: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`)
    }
    const send = (method, params = {}) => new Promise(resolve => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })) })
    await send('Runtime.enable')
    await send('Page.enable')
    await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false })
    try {
      return await fn({ send, problems })
    } finally {
      ws.close()
    }
  } finally {
    chrome.kill()
  }
}

async function evaluate(send, expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'evaluation failed')
  return r.result.result.value
}

if (!CHROME) {
  console.error('studio-smoke: Chrome not found (set CHROME_PATH)')
  process.exit(1)
}
mkdirSync(OUT, { recursive: true })
let failures = 0
for (const scenario of SCENARIOS) {
  const server = await startDevServer(scenario.file)
  try {
    await withChrome(async ({ send, problems }) => {
      await send('Page.navigate', { url: server.url })
      // Wait for the studio store to settle (or a fixed time for builds without the test hook).
      let hooked = false
      for (let i = 0; i < 60; i++) {
        await sleep(250)
        const status = await evaluate(send, 'window.__overscanStudio?.getState().status ?? null')
        hooked = status !== null
        if (status === 'ready' || status === 'error' || (!hooked && i >= 16)) break
      }
      const failed = [...problems]
      if (hooked) {
        for (const [label, check] of scenario.checks) {
          const ok = await evaluate(send, `(${check})(window.__overscanStudio.getState())`).catch(e => `threw ${e.message}`)
          if (ok !== true) failed.push(`check '${label}' ${ok === false ? 'failed' : ok}`)
        }
        const error = await evaluate(send, 'window.__overscanStudio.getState().error')
        if (error) failed.push(`studio error: ${error}`)
      }
      const shot = await send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(join(OUT, `${scenario.name}.png`), Buffer.from(shot.result.data, 'base64'))
      const note = hooked ? '' : ' (no test hook: console checks only)'
      if (failed.length) {
        failures++
        console.log(`✗ ${scenario.name}: ${scenario.file}${note}\n  ${failed.join('\n  ')}`)
      } else {
        console.log(`✓ ${scenario.name}: ${scenario.file}${note}`)
      }
    })
  } finally {
    server.proc.kill()
  }
}
console.log(`studio-smoke: ${SCENARIOS.length - failures}/${SCENARIOS.length} passed · screenshots in bench-results/studio-smoke/`)
process.exitCode = failures ? 1 : 0
