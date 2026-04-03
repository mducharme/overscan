#!/usr/bin/env node
import { parseArgs } from 'node:util'
import type { TerminalMode } from '@overscan/types'
import type { RunOptions } from './commands/run.js'
import type { ExportKind } from './commands/export.js'

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    mode:     { type: 'string' },
    fps:      { type: 'string' },
    frames:   { type: 'string' },
    seek:     { type: 'string' },
    rate:     { type: 'string' },
    profile:  { type: 'string' },
    png:      { type: 'string' },
    'png-gl': { type: 'string' },
    mp4:      { type: 'string' },
    gif:      { type: 'string' },
    terminal: { type: 'boolean' },
    'terminal-mode': { type: 'string' },
    'terminal-cols': { type: 'string' },
    'terminal-rows': { type: 'string' },
    'cell-width': { type: 'string' },
    'cell-height': { type: 'string' },
    'ascii-font': { type: 'string' },
    'ascii-font-family': { type: 'string' },
    'sixel-scale': { type: 'string' },
    'no-display': { type: 'boolean' },
    help:     { type: 'boolean', short: 'h' },
  },
})

const command = positionals[0]

if (values['help'] || !command) {
  console.log(`
  overscan <command> [options]

  Commands:
    dev <scene.json|demo.json>     Open Overscan Studio in the browser
    run <scene.json|demo.json>     Terminal playback (Esc / Ctrl+C; duration or --frames)
    export <scene.json>            PNG / WebGL PNG / MP4 / GIF (see below)
    validate <scene.json|demo.json> Validate a scene or demo file
    init <name>              Scaffold a new scene

  run — Options:
    --mode sixel|ansi|ascii   Terminal mode (auto-detected; WezTerm defaults to ansi)
    --fps <n>                Override terminal frame rate cap
    --frames <n>             Render N frames then exit (headless / CI)
    --no-display             No terminal output (smoke tests)
    --seek <sec>             Start timeline here (overscan-improvement §2.1)
    --rate <n>               Playback speed (default 1; 0.5 = half speed)
    --profile <n>            Log avg node timing every N frames (e.g. 30)
    -h, --help

  export — give exactly one destination:
    --png <dir>              PNG sequence (node-canvas encode), uses graph.outputs.export
    --png-gl <dir>           Same, but each frame blits through headless WebGL (texture + GLSL) first
    --mp4 <file>             H.264 MP4 via ffmpeg stdin (ffmpeg must be on PATH)
    --gif <file>             Animated GIF via ffmpeg palette (no audio)
    --frames <n>             Optional frame cap
    --terminal               Rasterize like terminal playback (uses graph.outputs.terminal path)
    --terminal-mode ansi|ascii|sixel   With --terminal (default ansi)
    --terminal-cols <n>      With --terminal (required)
    --terminal-rows <n>      With --terminal (required)
    --cell-width <px>        Terminal cell width for raster (default 8)
    --cell-height <px>       Terminal cell height for raster (default 16)
    --ascii-font <path>      Optional font file for ASCII terminal raster
    --ascii-font-family <name>  CSS family when no --ascii-font (default monospace)
    --sixel-scale <n>        Integer pixel scale for sixel framebuffer (default 2)

  Environment:
    DEMO_SIXEL=1              In WezTerm, force sixel instead of default ansi
    DEBUG_TERMINAL=1        Log terminal mode and frame size to stderr each frame
    DEMO_SILENT_EXIT=1      Suppress summary lines on stderr
  `)
  process.exit(0)
}

function oneOf<T extends string>(label: string, choices: Record<T, string | undefined>): T | undefined {
  const defined = (Object.entries(choices) as [T, string | undefined][])
    .filter(([, v]) => v !== undefined && String(v).length > 0)
  if (defined.length > 1) {
    console.error(`overscan ${label}: specify only one of ${Object.keys(choices).join(', ')}`)
    process.exit(1)
  }
  return defined[0]?.[0]
}

switch (command) {
  case 'dev': {
    const filePath = positionals[1]
    if (!filePath) { console.error('Usage: overscan dev <scene.json|demo.json>'); process.exit(1) }
    const { dev } = await import('./commands/dev.js')
    try {
      await dev(filePath)
    } catch (e) {
      console.error(e instanceof Error ? e.message : e)
      process.exit(1)
    }
    break
  }
  case 'run': {
    const scenePath = positionals[1]
    if (!scenePath) { console.error('Usage: overscan run <scene.json>'); process.exit(1) }
    const { run } = await import('./commands/run.js')
    const runOpts: RunOptions = {
      noDisplay: values['no-display'] ?? false,
    }
    const rawMode = values['mode'] as string | string[] | undefined
    const modeStr = Array.isArray(rawMode) ? rawMode[0] : rawMode
    const modeNorm = typeof modeStr === 'string' ? modeStr.trim().toLowerCase() : undefined
    if (modeNorm === 'sixel' || modeNorm === 'ansi' || modeNorm === 'ascii') {
      runOpts.mode = modeNorm as TerminalMode
    } else if (rawMode !== undefined) {
      console.warn(`overscan: ignoring unknown --mode ${String(rawMode)} (use sixel, ansi, or ascii)`)
    }
    if (values['fps'] !== undefined) runOpts.fpsCap = parseInt(String(values['fps']), 10)
    if (values['frames'] !== undefined) runOpts.maxFrames = parseInt(String(values['frames']), 10)
    if (values['seek'] !== undefined) runOpts.seek = parseFloat(String(values['seek']))
    if (values['rate'] !== undefined) runOpts.rate = parseFloat(String(values['rate']))
    if (values['profile'] !== undefined) {
      const pe = parseInt(String(values['profile']), 10)
      runOpts.profileEvery = Number.isFinite(pe) && pe > 0 ? pe : 30
    }
    try {
      await run(scenePath, runOpts)
    } catch (e) {
      console.error(e instanceof Error ? e.message : e)
      process.exit(1)
    }
    break
  }
  case 'export': {
    const scenePath = positionals[1]
    if (!scenePath) {
      console.error('Usage: overscan export <scene.json> (--png <dir> | --png-gl <dir> | --mp4 <file> | --gif <file>)')
      process.exit(1)
    }
    const pngRaw    = values['png'] as string | string[] | undefined
    const pngGlRaw  = values['png-gl'] as string | string[] | undefined
    const mp4Raw    = values['mp4'] as string | string[] | undefined
    const gifRaw    = values['gif'] as string | string[] | undefined
    const png    = Array.isArray(pngRaw) ? pngRaw[0] : pngRaw
    const pngGl  = Array.isArray(pngGlRaw) ? pngGlRaw[0] : pngGlRaw
    const mp4    = Array.isArray(mp4Raw) ? mp4Raw[0] : mp4Raw
    const gif    = Array.isArray(gifRaw) ? gifRaw[0] : gifRaw
    const kind = oneOf<ExportKind>('export', {
      png: typeof png === 'string' ? png : undefined,
      'png-gl': typeof pngGl === 'string' ? pngGl : undefined,
      mp4: typeof mp4 === 'string' ? mp4 : undefined,
      gif: typeof gif === 'string' ? gif : undefined,
    })
    if (kind === undefined) {
      console.error('overscan export: specify exactly one of --png, --png-gl, --mp4, --gif')
      process.exit(1)
    }
    const output = (kind === 'mp4' ? mp4 : kind === 'gif' ? gif : kind === 'png' ? png : pngGl) as string

    const useTerminal = values['terminal'] === true
    if (useTerminal) {
      const colsStr = values['terminal-cols']
      const rowsStr = values['terminal-rows']
      if (colsStr === undefined || rowsStr === undefined) {
        console.error('overscan export: --terminal requires --terminal-cols and --terminal-rows')
        process.exit(1)
      }
    }

    let terminal: import('./commands/export.js').TerminalExportGrid | undefined
    if (useTerminal) {
      const cols = parseInt(String(values['terminal-cols']), 10)
      const rows = parseInt(String(values['terminal-rows']), 10)
      if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 1 || rows < 1) {
        console.error('overscan export: --terminal-cols and --terminal-rows must be positive integers')
        process.exit(1)
      }
      const rawTm = values['terminal-mode']
      const tmStr = Array.isArray(rawTm) ? rawTm[0] : rawTm
      const tmNorm = typeof tmStr === 'string' ? tmStr.trim().toLowerCase() : 'ansi'
      let mode: TerminalMode = 'ansi'
      if (tmNorm === 'sixel' || tmNorm === 'ansi' || tmNorm === 'ascii') mode = tmNorm
      else if (rawTm !== undefined) {
        console.warn(`overscan export: unknown --terminal-mode ${String(rawTm)}; using ansi`)
      }
      const cw = values['cell-width'] !== undefined ? parseInt(String(values['cell-width']), 10) : 8
      const ch = values['cell-height'] !== undefined ? parseInt(String(values['cell-height']), 10) : 16
      if (!Number.isFinite(cw) || !Number.isFinite(ch) || cw < 1 || ch < 1) {
        console.error('overscan export: --cell-width and --cell-height must be positive integers')
        process.exit(1)
      }
      const af = values['ascii-font']
      const aff = values['ascii-font-family']
      const sixelScaleRaw = values['sixel-scale']
      terminal = {
        mode,
        cols,
        rows,
        cellWidth: cw,
        cellHeight: ch,
        ...((): { sixelPixelScale?: number } => {
          if (sixelScaleRaw === undefined) return {}
          const sp = parseInt(String(sixelScaleRaw), 10)
          return Number.isFinite(sp) && sp >= 1 ? { sixelPixelScale: sp } : {}
        })(),
        ...(typeof af === 'string' && af.length > 0 ? { asciiFontPath: af } : {}),
        ...(typeof aff === 'string' && aff.length > 0 ? { asciiFontFamily: aff } : {}),
      }
    }

    const { exportScene } = await import('./commands/export.js')
    try {
      await exportScene(scenePath, {
        kind,
        output,
        ...(values['frames'] !== undefined
          ? { maxFrames: parseInt(String(values['frames']), 10) }
          : {}),
        ...(terminal !== undefined ? { terminal } : {}),
      })
    } catch (e) {
      console.error(e instanceof Error ? e.message : e)
      process.exit(1)
    }
    break
  }
  case 'validate': {
    const scenePath = positionals[1]
    if (!scenePath) { console.error('Usage: overscan validate <scene.json>'); process.exit(1) }
    const { validate } = await import('./commands/validate.js')
    await validate(scenePath)
    break
  }
  case 'init': {
    const name = positionals[1] ?? 'my-scene'
    const { init } = await import('./commands/init.js')
    await init(name)
    break
  }
  default:
    console.error(`Unknown command: ${command}`)
    process.exit(1)
}
