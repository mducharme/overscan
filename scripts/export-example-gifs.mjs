#!/usr/bin/env node
/**
 * For each *.scene.json under examples/generators and examples/advanced:
 *   - {name}-terminal.gif  — 5s, terminal raster export (ANSI half-block, 80×24 grid)
 *   - {name}-ascii.gif     — 5s, ASCII at 160×48 char grid (2× density), then scaled to 640×384 to match ANSI GIF
 *   - {name}-webgl.gif     — 5s, export graph via headless WebGL blit → ffmpeg GIF
 *
 * Requires: pnpm build, ffmpeg on PATH.
 * Output: docs/examples/generators/ and docs/examples/advanced/
 */
import { spawnSync } from 'node:child_process'
import { readdir, readFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const CLI = join(ROOT, 'packages', 'cli', 'dist', 'cli.js')
const EXAMPLES_GENERATORS = resolve(ROOT, 'examples', 'generators')
const EXAMPLES_ADVANCED = resolve(ROOT, 'examples', 'advanced')
const OUT_GENERATORS = resolve(ROOT, 'docs', 'examples', 'generators')
const OUT_ADVANCED = resolve(ROOT, 'docs', 'examples', 'advanced')
const DIRS = [EXAMPLES_GENERATORS, EXAMPLES_ADVANCED]

const DURATION_SEC = 5
const TERM_COLS = 80
const TERM_ROWS = 24
/** Supersample ASCII grid vs ANSI (160×48 → scale down to same pixel size as 80×24 ANSI). */
const ASCII_GRID_COLS = TERM_COLS * 2
const ASCII_GRID_ROWS = TERM_ROWS * 2
/** Pixel size of doc GIFs for ANSI (and target for scaled ASCII); default 8×16 cells. */
const RASTER_OUT_W = TERM_COLS * 8
const RASTER_OUT_H = TERM_ROWS * 16

function sceneBaseName(filePath) {
  const name = basename(filePath)
  return name.replace(/\.scene\.json$/i, '')
}

async function listSceneJson(dir) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.scene.json'))
    .map((e) => join(dir, e.name))
    .sort((a, b) => basename(a).localeCompare(basename(b)))
}

async function readSceneFps(scenePath) {
  try {
    const raw = await readFile(scenePath, 'utf8')
    const j = JSON.parse(raw)
    const fps = Number(j.fps)
    return Number.isFinite(fps) && fps > 0 ? fps : 30
  } catch {
    return 30
  }
}

function runNode(args, label) {
  const r = spawnSync(process.execPath, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  })
  if (r.error) {
    console.error(`[${label}] spawn error:`, r.error.message)
    return 1
  }
  return r.status ?? 1
}

function runFfmpegPngToGif(pngDir, fps, outGif, label) {
  const vf = 'split[s0][s1];[s0]palettegen=max_colors=256[p];[s1][p]paletteuse'
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-framerate',
    String(fps),
    '-i',
    join(pngDir, 'frame-%06d.png'),
    '-vf',
    vf,
    '-loop',
    '0',
    outGif,
  ]
  const r = spawnSync('ffmpeg', args, { cwd: ROOT, stdio: 'inherit' })
  if (r.error) {
    console.error(`[${label}] ffmpeg:`, r.error.message)
    return 1
  }
  return r.status ?? 1
}

/** Re-encode GIF: scale to match ANSI export dimensions, then palette (sharper ASCII previews). */
function runFfmpegScaleGifToMatchAnsi(inGif, outGif, label) {
  const vf = `scale=${RASTER_OUT_W}:${RASTER_OUT_H}:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=256[p];[s1][p]paletteuse`
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    inGif,
    '-vf',
    vf,
    '-loop',
    '0',
    outGif,
  ]
  const r = spawnSync('ffmpeg', args, { cwd: ROOT, stdio: 'inherit' })
  if (r.error) {
    console.error(`[${label}] ffmpeg scale:`, r.error.message)
    return 1
  }
  return r.status ?? 1
}

function checkFfmpeg() {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  return r.status === 0
}

/** Maps `examples/generators|advanced/foo.scene.json` → `docs/examples/generators|advanced/`. */
function outDirForScene(scenePath) {
  const d = resolve(dirname(scenePath))
  if (d === EXAMPLES_GENERATORS) return OUT_GENERATORS
  if (d === EXAMPLES_ADVANCED) return OUT_ADVANCED
  throw new Error(`Scene not under examples/generators or examples/advanced: ${scenePath}`)
}

async function main() {
  if (!checkFfmpeg()) {
    console.error('export-example-gifs: ffmpeg not found on PATH (needed for GIF and WebGL→GIF).')
    process.exit(1)
  }

  await mkdir(OUT_GENERATORS, { recursive: true })
  await mkdir(OUT_ADVANCED, { recursive: true })

  const scenes = []
  for (const d of DIRS) {
    scenes.push(...(await listSceneJson(d)))
  }

  if (scenes.length === 0) {
    console.error('No .scene.json files found under examples/generators or examples/advanced.')
    process.exit(1)
  }

  let failed = 0
  for (const scenePath of scenes) {
    const base = sceneBaseName(scenePath)
    const rel = scenePath.slice(ROOT.length + 1)
    const outDir = outDirForScene(scenePath)
    const fps = await readSceneFps(scenePath)
    const frames = Math.max(1, Math.ceil(DURATION_SEC * fps))
    const terminalOut = join(outDir, `${base}-terminal.gif`)
    const asciiOut = join(outDir, `${base}-ascii.gif`)
    const webglOut = join(outDir, `${base}-webgl.gif`)

    console.log(`\n=== ${rel} (fps=${fps}, frames=${frames}) ===`)

    const tArgs = [
      CLI,
      'export',
      scenePath,
      '--terminal',
      '--terminal-mode',
      'ansi',
      '--terminal-cols',
      String(TERM_COLS),
      '--terminal-rows',
      String(TERM_ROWS),
      '--gif',
      terminalOut,
      '--frames',
      String(frames),
    ]
    if (runNode(tArgs, `${base}-terminal`) !== 0) {
      console.error(`FAILED: ${base}-terminal.gif`)
      failed++
    }

    const tmpAsciiGif = join(tmpdir(), `overscan-ascii-hi-${base}-${Date.now()}.gif`)
    const aArgs = [
      CLI,
      'export',
      scenePath,
      '--terminal',
      '--terminal-mode',
      'ascii',
      '--terminal-cols',
      String(ASCII_GRID_COLS),
      '--terminal-rows',
      String(ASCII_GRID_ROWS),
      '--gif',
      tmpAsciiGif,
      '--frames',
      String(frames),
    ]
    let asciiOk = runNode(aArgs, `${base}-ascii-hi`) === 0
    if (asciiOk) {
      asciiOk = runFfmpegScaleGifToMatchAnsi(tmpAsciiGif, asciiOut, `${base}-ascii-scale`) === 0
      if (!asciiOk) {
        console.error(`FAILED: ${base}-ascii.gif (scale to ${RASTER_OUT_W}×${RASTER_OUT_H})`)
        failed++
      }
    } else {
      console.error(`FAILED: ${base}-ascii.gif (export)`)
      failed++
    }
    try {
      await rm(tmpAsciiGif, { force: true })
    } catch {
      /* ignore */
    }

    const tmpPng = join(tmpdir(), `overscan-webgl-gif-${base}-${Date.now()}`)
    await mkdir(tmpPng, { recursive: true })
    const glArgs = [
      CLI,
      'export',
      scenePath,
      '--png-gl',
      tmpPng,
      '--frames',
      String(frames),
    ]
    let glOk = runNode(glArgs, `${base}-webgl-png`) === 0
    if (glOk) {
      glOk = runFfmpegPngToGif(tmpPng, fps, webglOut, `${base}-webgl`) === 0
    }
    try {
      await rm(tmpPng, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    if (!glOk) {
      console.error(`FAILED: ${base}-webgl.gif`)
      failed++
    }
  }

  console.log(`\nDone. Output: docs/examples/generators/ and docs/examples/advanced/`)
  if (failed > 0) {
    console.error(`${failed} step(s) failed.`)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
