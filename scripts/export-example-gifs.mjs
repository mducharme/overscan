#!/usr/bin/env node
/**
 * Animated previews for the examples gallery (docs/EXAMPLES.md). For each *.scene.json under
 * examples/{generators,modifiers,compositors,signals,advanced}:
 *   - docs/examples/<dir>/<name>-ansi.gif — the terminal look: ANSI half-blocks on an 80×24 grid
 *   - docs/examples/<dir>/<name>.gif      — full resolution
 * Both are 3 s at 10 fps with small palettes, so the gallery stays light in the repository.
 *
 * Requires `pnpm build` and ffmpeg on PATH. Pass example names (e.g. `plasma tunnel`) to export only those.
 */
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { cpus, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const CLI = join(ROOT, 'packages', 'cli', 'dist', 'cli.js')
const GALLERY_DIRS = ['generators', 'modifiers', 'compositors', 'signals', 'advanced']

const SECONDS = 3
const SOURCE_FPS = 30
const GIF_FPS = 10
const ANSI_WIDTH = 320
const FULL_WIDTH = 400
const PARALLEL = Math.max(1, Math.min(6, Math.floor(cpus().length / 2)))

const run = (cmd, args) => new Promise(resolve => {
  const child = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'] })
  let err = ''
  child.stderr.on('data', d => { err += d })
  child.on('close', code => { resolve({ ok: code === 0, err }) })
})

/** PNG frames → a small looping GIF: one palette for the clip, only changed rectangles re-encoded. */
function toGif(frames, out, width, sharp, colors) {
  const palette = `split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=${sharp ? 'none' : 'bayer:bayer_scale=4'}:diff_mode=rectangle`
  return run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(SOURCE_FPS),
    '-i', join(frames, 'frame-%06d.png'),
    // Transparent pixels are composited over black, as the terminal and the studio show them.
    '-vf', `format=rgba,premultiply=inplace=1,format=rgb24,fps=${GIF_FPS},scale=${width}:-2:flags=${sharp ? 'neighbor' : 'lanczos'},${palette}`,
    '-loop', '0', out,
  ])
}

async function exportScene(dir, scenePath, name) {
  const outDir = join(ROOT, 'docs', 'examples', dir)
  const frames = String(SECONDS * SOURCE_FPS)
  const work = await mkdtemp(join(tmpdir(), `overscan-gallery-${name}-`))
  const problems = []
  try {
    const ansi = join(work, 'ansi')
    const full = join(work, 'full')
    let r = await run(process.execPath, [CLI, 'export', scenePath, '--terminal', '--terminal-mode', 'ansi', '--terminal-cols', '80', '--terminal-rows', '24', '--png', ansi, '--frames', frames])
    if (r.ok) r = await toGif(ansi, join(outDir, `${name}-ansi.gif`), ANSI_WIDTH, true, 64)
    if (!r.ok) problems.push(`ansi: ${r.err.trim().split('\n').at(-1)}`)
    r = await run(process.execPath, [CLI, 'export', scenePath, '--png', full, '--frames', frames])
    if (r.ok) r = await toGif(full, join(outDir, `${name}.gif`), FULL_WIDTH, false, 96)
    if (!r.ok) problems.push(`full: ${r.err.trim().split('\n').at(-1)}`)
  } finally {
    await rm(work, { recursive: true, force: true })
  }
  return problems
}

async function main() {
  const only = new Set(process.argv.slice(2))
  const jobs = []
  for (const dir of GALLERY_DIRS) {
    await mkdir(join(ROOT, 'docs', 'examples', dir), { recursive: true })
    const files = (await readdir(join(ROOT, 'examples', dir))).filter(f => f.endsWith('.scene.json')).sort()
    for (const f of files) {
      const name = f.replace(/\.scene\.json$/, '')
      if (only.size === 0 || only.has(name)) jobs.push({ dir, name, path: join(ROOT, 'examples', dir, f) })
    }
  }
  let failed = 0
  let next = 0
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++]
      const problems = await exportScene(job.dir, job.path, job.name)
      if (problems.length) {
        failed++
        console.error(`✗ ${job.dir}/${job.name}: ${problems.join('; ')}`)
      } else {
        console.log(`✓ ${job.dir}/${job.name}`)
      }
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker))
  console.log(`export-example-gifs: ${jobs.length - failed}/${jobs.length} examples → docs/examples/`)
  if (failed) process.exit(1)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
