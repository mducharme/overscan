#!/usr/bin/env node
/**
 * CPU render benchmarks for every built-in effect, example scene, and example demo.
 * Requires a prior `pnpm build` (uses package dist/ output, no sink / no encode).
 *
 *   pnpm bench                          # all suites
 *   pnpm bench --suite effects          # effects | scenes | demos (comma-separated)
 *   pnpm bench --filter plasma          # substring match on bench name
 *   pnpm bench --save bench-results/base.json   # write results
 *   pnpm bench --baseline bench-results/base.json   # compare medians (+ slower / - faster);
 *                                           # `*` marks benches whose output pixels changed
 *
 * Options: --frames <n> measured frames (default 60), --warmup <n> (default 10),
 *          --width/--height effect resolution (default 640x360), --repeat <n> runs per bench (best median kept).
 *
 * Effects are measured in isolation: only the target node's time (executor profiler) counts.
 * Modifiers get a plasma input; compositors get plasma + checkerboard-floor (+ no mask).
 */
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { cpus } from 'node:os'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const EXAMPLES = join(ROOT, 'examples')
const pkg = name => pathToFileURL(join(ROOT, 'packages', name, 'dist', 'index.js')).href

const core = await import(pkg('core'))
const nodes = await import(pkg('nodes'))
const { BufferPoolImpl, SceneLoader, createSceneRuntime, createDemoRuntimeDocument, renderDemoRuntimeFrame,
  renderSceneFrame, GraphExecutor, RocketTimeline, parseSceneJson } = core
const { buildBuiltinRegistry, listBuiltinImpls } = nodes

const { values } = parseArgs({
  options: {
    suite:    { type: 'string', default: 'effects,scenes,demos' },
    filter:   { type: 'string' },
    frames:   { type: 'string', default: '60' },
    warmup:   { type: 'string', default: '10' },
    repeat:   { type: 'string', default: '1' },
    width:    { type: 'string', default: '640' },
    height:   { type: 'string', default: '360' },
    save:     { type: 'string' },
    baseline: { type: 'string' },
    help:     { type: 'boolean', short: 'h' },
  },
})
if (values.help) {
  console.log(await readFile(fileURLToPath(import.meta.url), 'utf8').then(s => s.split('*/')[0]))
  process.exit(0)
}

const suites = new Set(values.suite.split(',').map(s => s.trim()))
const FRAMES = Math.max(1, parseInt(values.frames, 10))
const WARMUP = Math.max(0, parseInt(values.warmup, 10))
const REPEAT = Math.max(1, parseInt(values.repeat, 10))
const W = parseInt(values.width, 10)
const H = parseInt(values.height, 10)
const filter = values.filter?.toLowerCase()
const matches = name => !filter || name.toLowerCase().includes(filter)

const assetManager = scenePath => ({
  resolveAssetUrl(url) {
    if (/^([a-z]+:)?\/\//i.test(url) || url.startsWith('overscan://')) return url
    return new SceneLoader().resolveScenePath(scenePath, url)
  },
  loadText: path => readFile(path, 'utf8'),
  loadBinary: path => readFile(path),
})

/** FNV-1a over the RGBA bytes (sampled every 4th word for speed). Used to flag pixel changes vs a baseline. */
function hashBuffer(h, data) {
  const words = new Uint32Array(data.buffer, data.byteOffset, data.byteLength >>> 2)
  for (let i = 0; i < words.length; i += 4) {
    h ^= words[i]
    h = Math.imul(h, 16777619) >>> 0
  }
  return h
}

function stats(samples) {
  const s = [...samples].sort((a, b) => a - b)
  const q = p => s[Math.min(s.length - 1, Math.floor(p * s.length))]
  const mean = s.reduce((a, b) => a + b, 0) / s.length
  return { median: q(0.5), p95: q(0.95), min: s[0], mean }
}

/** Collects per-node times for the frame currently being rendered. */
function makeProfiler() {
  const frame = new Map()
  return {
    frame,
    record(id, ms) { frame.set(id, (frame.get(id) ?? 0) + ms) },
  }
}

function makeCtx(pool, width, height, assets) {
  return { canvas: null, ctx2d: null, gl: null, pool, width, height, ...(assets ? { assets } : {}) }
}

// ─── effects ──────────────────────────────────────────────────────────────────


/** Non-default configs so an effect does representative work (most nodes are fine with `{}`). */
const EFFECT_CONFIG = {
  transition: { progress: 0.5, mode: 'dissolve' },
  text: { text: 'OVERSCAN BENCH' },
  scroller: { text: 'OVERSCAN BENCHMARK SCROLLER ' },
}

function effectScene(impl, kind, inputs) {
  const target = { id: 'target', type: kind, impl, config: EFFECT_CONFIG[impl] ?? {} }
  const graphNodes = [target]
  const edges = []
  if (kind === 'modifier') {
    graphNodes.unshift({ id: 'srcA', type: 'generator', impl: 'plasma', config: {} })
    edges.push({ from: { node: 'srcA', output: 'color' }, to: { node: 'target', input: 'in' } })
  } else if (kind === 'compositor') {
    graphNodes.unshift(
      { id: 'srcA', type: 'generator', impl: 'plasma', config: {} },
      { id: 'srcB', type: 'generator', impl: 'checkerboard-floor', config: {} },
    )
    const wired = inputs.filter(i => i !== 'mask')
    wired.forEach((input, i) => edges.push({
      from: { node: i % 2 === 0 ? 'srcA' : 'srcB', output: 'color' },
      to: { node: 'target', input },
      z: i,
    }))
  }
  const outputNode = kind === 'signal' ? (graphNodes.unshift({ id: 'out', type: 'generator', impl: 'plasma', config: {} }), 'out') : 'target'
  return parseSceneJson(JSON.stringify({
    id: `bench-${impl}`,
    title: `bench ${impl}`,
    duration: 3600,
    bpm: 120,
    rowsPerBeat: 8,
    resolution: { width: W, height: H },
    fps: 30,
    tracks: [],
    graph: { nodes: graphNodes, edges, outputs: { export: outputNode } },
  }))
}

async function benchEffect(impl) {
  // Probe kind / inputs via the real registry.
  const probe = buildBuiltinRegistry([{ id: 'p', type: 'generator', impl, config: EFFECT_CONFIG[impl] ?? {} }]).get('p')
  const kind = probe.type
  const scene = effectScene(impl, kind, probe.inputs ?? [])
  const runtime = await createSceneRuntime(scene, { sinkId: 'export', buildRegistry: buildBuiltinRegistry, assetManager: assetManager(join(ROOT, 'bench.scene.json')) })
  return measureScene(scene, runtime, { focus: 'target', kind })
}

// ─── scenes ───────────────────────────────────────────────────────────────────

function measureScene(scene, runtime, { focus } = {}) {
  const pool = new BufferPoolImpl()
  const ctx = makeCtx(pool, scene.resolution.width, scene.resolution.height, runtime.assets)
  runtime.executor.init(ctx)
  const profiler = makeProfiler()
  const frameSec = 1 / scene.fps
  const frameMs = []
  const focusMs = []
  const nodeTotals = new Map()
  const total = WARMUP + FRAMES
  let hash = 2166136261
  for (let frame = 0; frame < total; frame++) {
    profiler.frame.clear()
    const t = frame * frameSec
    const t0 = performance.now()
    const { buffer } = renderSceneFrame({
      scene, pool, ctx,
      timeline: runtime.timeline,
      executor: runtime.executor,
      outputNodeId: runtime.outputNodeId,
    }, t, frame, frame === 0 ? 0 : frameSec, profiler, { strictErrors: true })
    const dt = performance.now() - t0
    hash = hashBuffer(hash, buffer.data)
    pool.release(buffer)
    if (frame < WARMUP) continue
    frameMs.push(dt)
    if (focus) focusMs.push(profiler.frame.get(focus) ?? 0)
    for (const [id, ms] of profiler.frame) nodeTotals.set(id, (nodeTotals.get(id) ?? 0) + ms)
  }
  runtime.executor.destroy?.()
  const nodesAvg = Object.fromEntries([...nodeTotals].map(([id, ms]) => [id, ms / FRAMES]))
  return { ...stats(focus ? focusMs : frameMs), frame: stats(frameMs).median, hash, nodes: nodesAvg, resolution: `${scene.resolution.width}x${scene.resolution.height}` }
}

async function benchSceneFile(path) {
  const loader = new SceneLoader()
  const scene = await loader.loadFile(path)
  const runtime = await createSceneRuntime(scene, { sinkId: 'export', buildRegistry: buildBuiltinRegistry, assetManager: assetManager(path) })
  const r = measureScene(scene, runtime)
  // Map node id → impl for readable hotspots.
  const impls = Object.fromEntries(scene.graph.nodes.map(n => [n.id, n.impl]))
  r.nodes = Object.fromEntries(Object.entries(r.nodes).map(([id, ms]) => [`${id}(${impls[id] ?? '?'})`, ms]))
  return r
}

// ─── demos ────────────────────────────────────────────────────────────────────

async function benchDemoFile(path) {
  const loader = new SceneLoader()
  const loaded = await loader.loadAnyFile(path)
  const doc = await createDemoRuntimeDocument(loaded.demo, {
    sinkId: 'export',
    buildRegistry: buildBuiltinRegistry,
    assetManager: assetManager(path),
    sectionAssetManager: scenePath => assetManager(scenePath),
    async loadSection(raw) {
      const scenePath = loader.resolveScenePath(path, raw)
      return { scene: await loader.loadFile(scenePath), scenePath }
    },
  })
  const pool = new BufferPoolImpl()
  const ctx = makeCtx(pool, doc.resolution.width, doc.resolution.height)
  for (const s of doc.sections) {
    ctx.assets = s.runtime.assets
    s.runtime.executor.init(ctx)
  }
  // Sample FRAMES per section: consecutive frames starting at each section's midpoint-ish window,
  // so stateful effects still evolve while every section is covered.
  const frameSec = 1 / doc.fps
  const frameMs = []
  const perSection = {}
  let frame = 0
  let hash = 2166136261
  for (const section of doc.sections) {
    const start = section.start + Math.max(0, (section.end - section.start) / 2 - ((WARMUP + FRAMES) * frameSec) / 2)
    const samples = []
    for (let i = 0; i < WARMUP + FRAMES; i++) {
      const t = Math.min(start + i * frameSec, section.end - 1e-6)
      const t0 = performance.now()
      const rendered = renderDemoRuntimeFrame(doc, { pool, ctx, t, frame, dt: i === 0 ? 0 : frameSec, options: { strictErrors: true } })
      const dt = performance.now() - t0
      if (rendered) {
        hash = hashBuffer(hash, rendered.buffer.data)
        pool.release(rendered.buffer)
      }
      frame++
      if (i < WARMUP) continue
      samples.push(dt)
      frameMs.push(dt)
    }
    perSection[section.id ?? basename(section.scenePath)] = stats(samples).median
  }
  for (const s of doc.sections) s.runtime.executor.destroy?.()
  return { ...stats(frameMs), frame: stats(frameMs).median, hash, nodes: perSection, resolution: `${doc.resolution.width}x${doc.resolution.height}` }
}

// ─── runner ───────────────────────────────────────────────────────────────────

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git'].includes(e.name)) continue
    const full = join(dir, e.name)
    if (e.isDirectory()) yield* walk(full)
    else yield full
  }
}

async function exampleFiles(suffix) {
  const out = []
  for await (const f of walk(EXAMPLES)) if (f.endsWith(suffix)) out.push(f)
  return out.sort()
}

const jobs = []
if (suites.has('effects')) {
  for (const impl of listBuiltinImpls()) {
    jobs.push({ suite: 'effects', name: impl, run: () => benchEffect(impl) })
  }
}
if (suites.has('scenes')) {
  for (const f of await exampleFiles('.scene.json')) {
    jobs.push({ suite: 'scenes', name: relative(EXAMPLES, f).replace(/\.scene\.json$/, ''), run: () => benchSceneFile(f) })
  }
}
if (suites.has('demos')) {
  for (const f of await exampleFiles('.demo.json')) {
    jobs.push({ suite: 'demos', name: relative(EXAMPLES, f).replace(/\.demo\.json$/, ''), run: () => benchDemoFile(f) })
  }
}

const baseline = values.baseline ? JSON.parse(await readFile(values.baseline, 'utf8')) : null
const baseKey = r => `${r.suite}/${r.name}`
const baseMap = new Map((baseline?.results ?? []).map(r => [baseKey(r), r]))
// Hashes only cover the same frames when warmup/frames/resolution match.
const bo = baseline?.options
const hashComparable = !!bo && bo.warmup === WARMUP && bo.frames === FRAMES && bo.width === W && bo.height === H
if (baseline && !hashComparable) {
  console.log('bench: baseline used different warmup/frames/resolution — timing deltas only, no pixel check\n')
}

/** Seeded Math.random (mulberry32), reset per job so random-driven effects hash deterministically. */
function seedRandom(seed) {
  let a = seed >>> 0
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const fmt = n => (n === undefined ? '—' : n < 10 ? n.toFixed(3) : n.toFixed(2))
const pad = (s, n) => String(s).padEnd(n)
const lpad = (s, n) => String(s).padStart(n)

console.log(`bench: ${jobs.length} job(s), warmup=${WARMUP} frames=${FRAMES} repeat=${REPEAT} effects=${W}x${H}`)
console.log(`node ${process.version} · ${cpus()[0]?.model ?? 'unknown cpu'}\n`)

const results = []
let currentSuite = ''
let failures = 0
const changed = []
const origError = console.error
for (const job of jobs) {
  if (!matches(`${job.suite}/${job.name}`)) continue
  if (job.suite !== currentSuite) {
    currentSuite = job.suite
    console.log(`── ${currentSuite} ${'─'.repeat(70)}`)
    console.log(`${pad('name', 34)}${lpad('median', 10)}${lpad('p95', 10)}${lpad('fps', 9)}${baseline ? lpad('Δ base', 10) : ''}  hotspots`)
  }
  let best
  try {
    console.error = () => {}
    for (let i = 0; i < REPEAT; i++) {
      seedRandom(0x5eed)
      const r = await job.run()
      if (!best || r.median < best.median) best = r
    }
  } catch (e) {
    console.error = origError
    failures++
    console.log(`${pad(job.name, 34)}  FAILED: ${e instanceof Error ? e.message : e}`)
    continue
  } finally {
    console.error = origError
  }
  const row = { suite: job.suite, name: job.name, ...best }
  results.push(row)
  const base = baseMap.get(baseKey(row))
  const delta = base ? ((row.median - base.median) / base.median) * 100 : undefined
  const pixelsChanged = hashComparable && base && base.hash !== undefined && base.hash !== row.hash
  if (pixelsChanged) changed.push(baseKey(row))
  const deltaStr = delta === undefined ? '—' : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%${pixelsChanged ? '*' : ' '}`
  const hot = job.suite === 'effects'
    ? ''
    : Object.entries(row.nodes).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, ms]) => `${id} ${fmt(ms)}`).join(', ')
  const fps = job.suite === 'effects' ? 1000 / row.median : 1000 / row.frame
  console.log(`${pad(job.name, 34)}${lpad(fmt(row.median), 10)}${lpad(fmt(row.p95), 10)}${lpad(fps.toFixed(0), 9)}${baseline ? lpad(deltaStr, 10) : ''}  ${hot}`)
}

if (changed.length) {
  console.log(`\nbench: * output pixels differ from baseline (same frames/options) for ${changed.length}: ${changed.join(', ')}`)
}

if (values.save) {
  await mkdir(dirname(values.save), { recursive: true })
  await writeFile(values.save, JSON.stringify({
    date: new Date().toISOString(),
    node: process.version,
    cpu: cpus()[0]?.model,
    options: { warmup: WARMUP, frames: FRAMES, repeat: REPEAT, width: W, height: H },
    results,
  }, null, 2))
  console.log(`\nbench: saved ${results.length} result(s) → ${values.save}`)
}
if (failures) {
  console.log(`\nbench: ${failures} job(s) failed`)
  process.exitCode = 1
}
