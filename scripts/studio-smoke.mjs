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

/** A copy of the plasma showcase scene the edit scenario may change and save. */
function writeEditScene() {
  const dir = join(OUT, 'edit')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'plasma.scene.json'), readFileSync(join(ROOT, 'examples', 'showcase', '03-plasma.scene.json')))
  return 'bench-results/studio-smoke/edit/plasma.scene.json'
}

/** A second copy for the phase-5 editing scenario (undo, JSON, graph, keys). */
function writeAuthorScene() {
  const dir = join(OUT, 'author')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'plasma.scene.json'), readFileSync(join(ROOT, 'examples', 'showcase', '03-plasma.scene.json')))
  return 'bench-results/studio-smoke/author/plasma.scene.json'
}

/** Copies of examples the authoring scenarios may change and save, under bench-results/studio-smoke/<dir>/. */
function copyExample(dir, source, name = source.split('/').pop()) {
  mkdirSync(join(OUT, dir), { recursive: true })
  writeFileSync(join(OUT, dir, name), readFileSync(join(ROOT, 'examples', source)))
  return `bench-results/studio-smoke/${dir}/${name}`
}

/** A three-section demo over copies of the first showcase scenes. */
function writeEditDemo() {
  const dir = join(OUT, 'demo-edit')
  mkdirSync(dir, { recursive: true })
  const demo = JSON.parse(readFileSync(join(ROOT, 'examples', 'showcase.demo.json'), 'utf8'))
  demo.sections = demo.sections.slice(0, 3).map(s => {
    const name = s.scene.split('/').pop()
    writeFileSync(join(dir, name), readFileSync(join(ROOT, 'examples', 'showcase', name)))
    return { ...s, scene: `./${name}` }
  })
  writeFileSync(join(dir, 'edit.demo.json'), `${JSON.stringify(demo, null, 2)}\n`)
  return 'bench-results/studio-smoke/demo-edit/edit.demo.json'
}

/** Presses Enter in a field (fields commit on Enter). */
const enter = selector => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return 'no ${selector.replace(/'/g, '')}'; el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true })()`
const click = selector => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return 'nothing to click at ${selector.replace(/'/g, '')}'; el.click(); return true })()`
const tab = name => `(() => { const b = [...document.querySelectorAll('.ui-toggle-group[aria-label="Side panel"] button')].find(b => b.textContent === ${JSON.stringify(name)}); if (!b) return 'no ${name} tab'; b.click(); return true })()`

/** A real mouse drag from one element's centre to another's. */
const dragTo = (from, to) => async ({ send }) => {
  const centre = sel => evaluate(send, `(() => { const r = document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect(); return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
  const a = await centre(from)
  const b = await centre(to)
  if (!a || !b) return `cannot drag ${from} → ${to}`
  const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1 })
  await mouse('mousePressed', a.x, a.y, 1)
  for (let i = 1; i <= 8; i++) await mouse('mouseMoved', a.x + ((b.x - a.x) * i) / 8, a.y + ((b.y - a.y) * i) / 8, 1)
  await mouse('mouseReleased', b.x, b.y, 0)
  return true
}

/** Waits (up to `ms`) for page code to return true. */
const until = (code, ms, what) => `(async () => { for (let i = 0; i < ${ms / 100}; i++) { if (${code}) return true; await new Promise(r => setTimeout(r, 100)) } return 'timed out waiting for ${what}' })()`

/** Sets a text field's value as typing would (React listens for input events). */
const typeInto = (selector, value) => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return 'no ${selector.replace(/'/g, '')}'; const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${value}); el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); return true })()`

/** A real mouse drag (DevTools input events, so pointer capture and pointer events behave as in use). */
const drag = (selector, dx, dy) => async ({ send }) => {
  const rect = await evaluate(send, `(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
  if (!rect) return `nothing to drag at ${selector}`
  const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1 })
  await mouse('mousePressed', rect.x, rect.y, 1)
  for (let i = 1; i <= 6; i++) await mouse('mouseMoved', rect.x + (dx * i) / 6, rect.y + (dy * i) / 6, 1)
  await mouse('mouseReleased', rect.x + dx, rect.y + dy, 0)
  return true
}

const key = (k, modifiers = {}) => `window.dispatchEvent(new KeyboardEvent('keydown', ${JSON.stringify({ key: k, ...modifiers })}))`
const store = 'window.__overscanStudio.getState()'
const disk = `(await (await fetch('/__overscan__/read?path=' + encodeURIComponent(${store}.document.filePath))).json()).text`
const frame = `document.querySelector('.preview__canvas').toDataURL()`

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
      [`(() => { const n = document.querySelectorAll('.react-flow__node').length, want = ${store}.document.player.sectionAt(9).scene.graph.nodes.length + 1; return n === want || 'graph nodes: ' + n + ', expected ' + want })()`, 0],
      [`document.querySelector('.react-flow__node:not([data-id="__output__"])').dispatchEvent(new MouseEvent('click', { bubbles: true }))`, 300],
      [`(${store}.selectedNodeId !== null && document.querySelector('.details') !== null) || 'clicking a graph node should select and inspect it'`, 0],
      [key('Escape'), 100],
      [`${store}.selectedNodeId === null || 'Esc should clear the selection'`, 0],
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
  {
    name: 'edit',
    file: writeEditScene,
    steps: [
      [`(() => { window.__loadMarker = 1; window.__before = ${frame}; ${store}.selectNode('lens'); return true })()`, 400],
      // Drive the real slider, as a user would.
      [`(() => { const r = document.querySelector('input[type=range][aria-label="zoom"]'); if (!r) return 'no zoom slider in the inspector'; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(r, 4); r.dispatchEvent(new Event('input', { bubbles: true })); return true })()`, 800],
      [`${frame} !== window.__before || 'preview did not change after the edit'`, 0],
      [`(document.querySelector('.save__dot')?.textContent ?? '').includes('unsaved') || 'edit not marked unsaved'`, 0],
      [`(async () => { ${key('s', { metaKey: true })}; await new Promise(r => setTimeout(r, 600)); const text = ${disk}; return (text.includes('"zoom": 4,') && text.includes('"radius": 0.28, "zoom": 4, "centerX"')) || 'saved file is not a minimal in-place edit' })()`, 0],
      [`window.__loadMarker === 1 || 'saving reloaded the page'`, 0],
      // Someone else changes the file; our next save must refuse, then overwrite when forced.
      [`(async () => { const text = ${disk}; await fetch('/__overscan__/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filePath: ${store}.document.filePath, text: text + ' ' }) }); return true })()`, 300],
      [`(async () => { ${store}.setNodeParam(${store}.document.filePath, 'lens', 'zoom', 3); await ${store}.save(); return (${store}.saveError?.conflicts.length === 1) || 'outside change was not detected' })()`, 0],
      [`(async () => { await ${store}.save({ force: true }); return (${store}.saveError === null && (${disk}).includes('"zoom": 3,')) || 'forced save failed' })()`, 0],
    ],
    checks: [
      ['loads', 's => s.status === "ready"'],
      ['no edit error', 's => s.editError === null'],
      ['no render error', 's => s.renderError === null'],
    ],
  },
]

SCENARIOS.push(
  {
    name: 'author',
    file: writeAuthorScene,
    steps: [
      [`(() => { window.__original = ${store}.document.files[${store}.document.filePath].text; window.__text = () => ${store}.document.files[${store}.document.filePath].text; ${store}.selectNode('lens'); return true })()`, 400],
      // Undo and redo a slider edit with the keyboard.
      [typeInto('input[type=range][aria-label="zoom"]', 4), 300],
      [`window.__text().includes('"zoom": 4,') || 'slider edit missing'`, 0],
      [key('z', { metaKey: true }), 200],
      [`window.__text() === window.__original || 'undo did not restore the file'`, 0],
      [key('z', { metaKey: true, shiftKey: true }), 200],
      [`window.__text().includes('"zoom": 4,') || 'redo did not reapply'`, 0],
      // The JSON tab: an edit applies live once valid; an invalid one is held back and reported.
      [`(() => { const b = [...document.querySelectorAll('.ui-toggle-group button')].find(b => b.textContent === 'JSON'); if (!b) return 'no JSON tab'; b.click(); return true })()`, 300],
      [`document.querySelector('.json__text')?.value === window.__text() || 'JSON editor does not show the file'`, 0],
      [`(() => { window.__before = ${frame}; return true })()`, 0],
      [typeInto('.json__text', `window.__text().replace('"chroma": 0.8', '"chroma": 3')`), 900],
      [`window.__text().includes('"chroma": 3') || 'JSON edit not applied'`, 0],
      [`${frame} !== window.__before || 'preview did not change after the JSON edit'`, 0],
      [typeInto('.json__text', `window.__text().replace('"graph"', '"graph" oops')`), 900],
      [`(!window.__text().includes('oops') && document.querySelector('.json__error') !== null) || 'invalid JSON was applied or not reported'`, 0],
      [`(() => { const el = document.querySelector('.json__text'); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true })()`, 200],
      [`(document.querySelector('.json__text').value === window.__text() && !document.querySelector('.json__error')) || 'Escape did not restore the valid text'`, 0],
      // Graph: add a glow after the lens through the picker, then remove it with Delete.
      [`(() => { [...document.querySelectorAll('.ui-toggle-group button')].find(b => b.textContent === 'Graph').click(); return true })()`, 400],
      [typeInto('select[aria-label="Add a node"]', `'glow'`), 600],
      [`(${store}.selectedNodeId === 'glow' && JSON.parse(window.__text()).graph.outputs.browser === 'glow') || 'glow was not inserted after the lens'`, 0],
      [`document.querySelectorAll('.react-flow__node').length === 4 || 'graph shows ' + document.querySelectorAll('.react-flow__node').length + ' nodes'`, 0],
      [key('Delete'), 400],
      [`(!JSON.parse(window.__text()).graph.nodes.some(n => n.id === 'glow') && JSON.parse(window.__text()).graph.outputs.browser === 'lens') || 'Delete did not remove the node'`, 0],
      // Keys: drag the second lens.x key right and up.
      [`(() => { ${store}.selectNode(null); window.__key = JSON.parse(window.__text()).tracks[0].keys[1]; return document.querySelectorAll('.curve__key').length > 2 || 'no keys drawn' })()`, 200],
      [drag('.tl-row--track .curve__key:nth-of-type(2)', 30, -8), 400],
      [`(() => { const k = JSON.parse(window.__text()).tracks[0].keys[1]; return (k.row > window.__key.row && k.value !== window.__key.value) || 'key did not move: ' + JSON.stringify(k) })()`, 0],
      [`document.querySelector('.tl-key-editor') !== null || 'dragged key is not selected in the toolbar'`, 0],
      [`(() => { const n = ${store}.past.length; ${store}.undo(); return (JSON.parse(window.__text()).tracks[0].keys[1].row === window.__key.row && ${store}.past.length === n - 1) || 'a drag should undo in one step' })()`, 0],
    ],
    checks: [
      ['loads', 's => s.status === "ready"'],
      ['no edit error', 's => s.editError === null'],
      ['no render error', 's => s.renderError === null'],
    ],
  },
  {
    name: 'files',
    file: 'examples/generators/plasma.scene.json',
    steps: [
      [`(() => { document.querySelector('.files__current').click(); return true })()`, 600],
      [`document.querySelectorAll('.files__item').length > 50 || 'file list has ' + document.querySelectorAll('.files__item').length + ' entries'`, 0],
      [typeInto('.files__popover input', `'showcase demo'`), 100],
      [`(() => { document.querySelector('.files__popover input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true })()`, 3000],
      [`(${store}.document?.kind === 'demo' && ${store}.document.filePath.endsWith('showcase.demo.json')) || 'did not open the demo: ' + ${store}.document?.filePath`, 0],
      [`new URLSearchParams(location.search).get('file') === ${store}.document.filePath || 'URL does not remember the file'`, 0],
    ],
    checks: [
      ['loads', 's => s.status === "ready"'],
      ['no render error', 's => s.renderError === null'],
    ],
  },
)

const fileText = `${store}.document.files[${store}.document.filePath].text`
SCENARIOS.push(
  {
    name: 'wiring',
    file: () => copyExample('wiring', 'signals/lfo.scene.json'),
    steps: [
      // Drag the LFO's output onto the curve's settings handle, then pick the setting.
      [dragTo('.react-flow__node[data-id="lfo1"] .react-flow__handle.source', '.react-flow__node[data-id="curve1"] .ghandle--bind'), 300],
      [`document.querySelector('.graph__bind') !== null || 'no setting picker after dropping a signal'`, 0],
      [`(() => { const b = [...document.querySelectorAll('.graph__bind li button')].find(b => b.textContent.startsWith('delta')); if (!b) return 'delta not offered'; b.click(); return true })()`, 300],
      [`JSON.stringify(JSON.parse(${fileText}).graph.nodes[1].config.delta) === '{"node":"lfo1","output":"value"}' || 'delta not bound to the LFO'`, 0],
      // Tracks: add, rename by double-click, remove.
      [click('.tl-group__add'), 300],
      [`JSON.parse(${fileText}).tracks.length === 1 || 'track not added'`, 0],
      [`(() => { document.querySelector('.tl-track-label').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); return true })()`, 200],
      [typeInto('.tl-track-label__input', `'pulse'`), 50],
      [enter('.tl-track-label__input'), 300],
      [`JSON.parse(${fileText}).tracks[0]?.name === 'pulse' || 'rename failed: ' + JSON.parse(${fileText}).tracks[0]?.name`, 0],
      [click('.tl-track-label__remove'), 300],
      [`JSON.parse(${fileText}).tracks.length === 0 || 'track not removed'`, 0],
    ],
    checks: [
      ['loads', 's => s.status === "ready"'],
      ['no edit error', 's => s.editError === null'],
      ['no render error', 's => s.renderError === null'],
    ],
  },
  {
    name: 'demo-edit',
    file: writeEditDemo,
    steps: [
      [tab('Demo'), 400],
      [`document.querySelectorAll('.demo__section').length === 3 || 'Demo tab does not list the 3 sections'`, 0],
      [typeInto('input[aria-label="intro length"]', `'4'`), 50],
      [enter('input[aria-label="intro length"]'), 0],
      [until(`${store}.document.player.sections[0].end === 4`, 8000, 'the rebuilt demo'), 0],
      [typeInto('select[aria-label="intro transition"]', `'dissolve'`), 200],
      [`JSON.parse(${fileText}).sections[0].transition.type === 'dissolve' || 'transition not changed'`, 0],
      [click('button[aria-label="Move intro later"]'), 200],
      [`JSON.parse(${fileText}).sections.map(s => s.id).join() === 'copper,intro,plasma' || 'move failed'`, 0],
      [typeInto('select[aria-label="Add a demo-wide modifier"]', `'glow'`), 200],
      [`JSON.parse(${fileText}).modifiers.map(m => m.id).join() === 'crt,glow' || 'modifier not added'`, 0],
      [until(`${store}.document.player.sections[0].id === 'copper'`, 8000, 'the reordered demo'), 0],
      // Resize the first section on the timeline: drag its edge right.
      [`(() => { window.__len = ${store}.document.player.sections[0].end; return true })()`, 0],
      [drag('.tl-section .tl-section__edge', 80, 0), 0],
      [until(`${store}.document.player.sections[0].end > window.__len`, 8000, 'the resized section'), 0],
      [`(() => { const d = JSON.parse(${fileText}).sections[0].duration; return Math.abs(d * 2 - Math.round(d * 2)) < 1e-6 || 'length did not snap to beats: ' + d })()`, 0],
    ],
    checks: [
      ['loads', 's => s.status === "ready"'],
      ['no edit error', 's => s.editError === null'],
      ['no render error', 's => s.renderError === null'],
    ],
  },
  {
    name: 'export',
    file: () => copyExample('export', 'showcase/03-plasma.scene.json', 'plasma.scene.json'),
    steps: [
      [`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent === 'Export…'); if (!b) return 'no Export button'; b.click(); return true })()`, 300],
      [typeInto('select[aria-label="Look"]', `'ansi'`), 100],
      [typeInto('input[aria-label="Columns"]', `'80'`), 0],
      [enter('input[aria-label="Columns"]'), 0],
      [typeInto('input[aria-label="Rows"]', `'24'`), 0],
      [enter('input[aria-label="Rows"]'), 100],
      [`(() => { const b = [...document.querySelectorAll('.export__actions button')].find(b => b.textContent === 'Export'); if (!b) return 'no Export action'; b.click(); return true })()`, 0],
      [until(`document.querySelector('.export__done') || document.querySelector('.export__status .export__error')`, 90000, 'the export'), 0],
      [`document.querySelector('.export__done') !== null || document.querySelector('.export__error')?.textContent`, 0],
      [until(`document.querySelector('.export__preview')?.naturalWidth > 0`, 5000, 'the GIF preview'), 0],
      [`(async () => { const r = await (await fetch('/__overscan__/stat?path=' + encodeURIComponent(${store}.document.filePath.replace(/plasma\.scene\.json$/, 'plasma.gif')))).json(); return r.mtimeMs > 0 || 'no GIF on disk' })()`, 0],
    ],
    checks: [
      ['loads', 's => s.status === "ready"'],
      ['no render error', 's => s.renderError === null'],
    ],
  },
)

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
// STUDIO_SMOKE_ONLY=author,export runs just those scenarios.
const only = process.env.STUDIO_SMOKE_ONLY?.split(',')
for (const scenario of SCENARIOS.filter(s => !only || only.includes(s.name))) {
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
          const result = await (typeof code === 'function' ? code({ send }) : evaluate(send, code)).catch(e => `threw ${e.message}`)
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
const ran = SCENARIOS.filter(s => !only || only.includes(s.name)).length
console.log(`studio-smoke: ${ran - failures}/${ran} passed · screenshots in bench-results/studio-smoke/`)
process.exitCode = failures ? 1 : 0
