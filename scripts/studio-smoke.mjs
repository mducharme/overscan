#!/usr/bin/env node
/**
 * Studio smoke test: serves example files with `overscan dev --no-open`, loads each in headless Chrome
 * (DevTools protocol), and fails on console errors or uncaught exceptions. When the studio exposes
 * `window.__overscanStudio` (its store), scenario checks also assert on its state.
 * Requires `pnpm build` and Chrome (or CHROME_PATH). Screenshots go to bench-results/studio-smoke/.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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

/** A mono 16-bit WAV: a 110 Hz tone pulsing twice a second. */
function toneWav(seconds, rate = 22_050) {
  const n = seconds * rate
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) {
    const t = i / rate
    buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 110 * t) * Math.abs(Math.sin(Math.PI * 2 * t)) * 20_000), 44 + i * 2)
  }
  return buf
}

/** The first showcase sections with a generated soundtrack, written next to the screenshots. */
function writeAudioDemo() {
  const dir = join(OUT, 'audio-demo')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'tone.wav'), toneWav(30))
  const demo = JSON.parse(readFileSync(join(ROOT, 'examples', 'showcase.demo.json'), 'utf8'))
  demo.audio = 'tone.wav'
  demo.sections = demo.sections.slice(0, 3).map(s => ({ ...s, scene: `../../../examples/${s.scene}` }))
  writeFileSync(join(dir, 'audio.demo.json'), JSON.stringify(demo, null, 2))
  return 'bench-results/studio-smoke/audio-demo/audio.demo.json'
}

const key = k => `window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)} }))`
const store = 'window.__overscanStudio.getState()'

/**
 * Each scenario serves one file. Once the studio store reports ready, `steps` run in order (page JS,
 * then a pause in ms) and each `check` must return true for the store state.
 */
const SCENARIOS = [
  {
    name: 'scene',
    file: 'examples/generators/plasma.scene.json',
    steps: [
      [`${store}.play()`, 1200],
      [`${store}.time > 0.8 || 'time did not advance: ' + ${store}.time`, 0],
      [`${store}.pause(); ${store}.seek(2); ${key('ArrowRight')}`, 100],
      [`${store}.time === 7 || 'ArrowRight should skip 5 s in a scene, got ' + ${store}.time`, 0],
      [key(' '), 100],
      [`${store}.playing === true || 'Space should resume'`, 0],
      [key(' '), 100],
      [`${store}.playing === false || 'Space should pause'`, 0],
    ],
    checks: [
      ['loads', 's => s.status === "ready"'],
      ['one section', 's => s.document.player.sections.length === 1'],
      ['no render error', 's => s.renderError === null'],
    ],
  },
  {
    name: 'demo',
    file: 'examples/showcase.demo.json',
    steps: [
      [`${store}.play()`, 600],
      ...['2d', 'ansi', 'ascii', 'gl'].map(r => [`${store}.setRenderer('${r}')`, 700]),
      [`${store}.renderError === null || 'render error: ' + ${store}.renderError`, 0],
      [`${store}.pause(); ${store}.seek(0.5); ${key('ArrowRight')}`, 100],
      [`${store}.time === ${store}.document.player.sections[1].start || 'ArrowRight should jump to the next section'`, 0],
      [`document.querySelectorAll('.tl-section').length === 16 || 'timeline should show 16 sections'`, 0],
      [`${store}.seek(9)`, 300],
      [`(() => { const n = document.querySelectorAll('.tl-row--track').length, want = ${store}.document.player.sectionAt(9).scene.tracks.length; return n === want || 'track lanes: ' + n + ', expected ' + want })()`, 0],
      [`document.querySelectorAll('.tl-transition').length > 0 || 'transitions should be drawn'`, 0],
      [`${store}.play(); ${store}.seek(60)`, 800],
    ],
    checks: [
      ['loads', 's => s.status === "ready"'],
      ['all sections', 's => s.document.player.sections.length === 16'],
      ['no asset problems', 's => s.document.assetProblems.length === 0'],
      ['no render error', 's => s.renderError === null'],
    ],
  },
  {
    name: 'audio',
    file: writeAudioDemo,
    steps: [
      [`(() => { window.__plays = []; const play = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { window.__plays.push(this); return play.call(this) }; return true })()`, 1500],
      [`(document.querySelector('.waveform path')?.getAttribute('d') ?? '').length > 100 || 'waveform not drawn'`, 0],
      [`${store}.seek(2); ${store}.play()`, 1500],
      [`(() => { const a = window.__plays[0]; if (!a) return 'audio never started'; if (a.paused) return 'audio paused while playing'; const drift = Math.abs(a.currentTime - ${store}.time); return drift < 0.25 || 'audio drift ' + drift.toFixed(2) + ' s' })()`, 0],
      [`window.__plays.length === 1 || 'play() called ' + window.__plays.length + ' times'`, 0],
      [`${store}.pause()`, 200],
      [`window.__plays[0].paused || 'audio kept playing after pause'`, 0],
    ],
    checks: [
      ['loads', 's => s.status === "ready"'],
      ['no render error', 's => s.renderError === null'],
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
  const chrome = spawn(CHROME, ['--headless=new', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'studio-smoke-'))}`, 'about:blank'], { stdio: 'ignore' })
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
  if (typeof scenario.file === 'function') scenario.file = scenario.file()
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
      const failed = []
      if (hooked) {
        for (const [code, wait] of scenario.steps ?? []) {
          const result = await evaluate(send, code).catch(e => `threw ${e.message}`)
          if (typeof result === 'string') failed.push(`step: ${result}`)
          if (wait) await sleep(wait)
        }
        for (const [label, check] of scenario.checks) {
          const ok = await evaluate(send, `(${check})(window.__overscanStudio.getState())`).catch(e => `threw ${e.message}`)
          if (ok !== true) failed.push(`check '${label}' ${ok === false ? 'failed' : ok}`)
        }
        const error = await evaluate(send, 'window.__overscanStudio.getState().error')
        if (error) failed.push(`studio error: ${error}`)
      }
      failed.unshift(...problems)
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
