import { readFile } from 'node:fs/promises'
import type { BufferPool, Demo, NodeContext, Scene, Sink, TerminalMode } from '@overscan/types'
import {
  BufferPoolImpl,
  createDemoRuntimeDocument,
  createSceneRuntime,
  type DemoRuntimeDocument,
  renderDemoRuntimeFrame,
  SceneLoader,
} from '@overscan/core'
import {
  FfmpegSink,
  PngSequenceSink,
  TerminalRasterSink,
  WebglPngSequenceSink,
  type FfmpegAudioTrack,
  type TerminalRasterizeOptions,
} from '@overscan/sink-export'
import { terminalResolutionFromGrid } from '@overscan/sink-terminal'
import { renderLoop } from '../render-loop.js'
import { buildRegistry } from '../node-registry.js'
import { fileAssetOptions } from '../file-assets.js'

export type ExportKind = 'png' | 'png-gl' | 'mp4' | 'gif'

export interface TerminalExportGrid {
  mode: TerminalMode
  cols: number
  rows: number
  cellWidth: number
  cellHeight: number
  sixelPixelScale?: number
  asciiFontPath?: string
  asciiFontFamily?: string
}

export interface ExportOptions {
  kind: ExportKind
  output: string
  maxFrames?: number
  /** When set, render through the terminal graph path and rasterize like `overscan run`. */
  terminal?: TerminalExportGrid
  /** Called after each frame is written, with the number written so far. Throwing stops the export. */
  onFrame?: (frames: number) => void
}

/** Reports each written frame, so a caller can show progress (or stop the export by throwing). */
function withProgress(inner: Sink, onFrame: (frames: number) => void): Sink {
  let frames = 0
  return {
    id: inner.id,
    init: (width, height, fps) => inner.init(width, height, fps),
    async write(frame, index, signal) {
      await inner.write(frame, index, signal)
      onFrame(++frames)
    },
    flush: () => inner.flush(),
  }
}

function resolveExportOutputNodeId(scene: Scene): string {
  const id = scene.graph.outputs['export'] ?? scene.graph.nodes[0]?.id
  if (!id) throw new Error('Scene has no output node for export sink (graph.outputs.export)')
  return id
}

function createExportSink(
  kind: ExportKind,
  output: string,
  options?: { audioTracks?: FfmpegAudioTrack[]; durationSeconds?: number },
): Sink {
  switch (kind) {
    case 'png':
      return new PngSequenceSink({ outputDir: output })
    case 'png-gl':
      return new WebglPngSequenceSink({ outputDir: output })
    case 'mp4':
      return new FfmpegSink({
        outputPath: output,
        ...(options?.audioTracks !== undefined ? { audioTracks: options.audioTracks } : {}),
        ...(options?.durationSeconds !== undefined ? { durationSeconds: options.durationSeconds } : {}),
      })
    case 'gif':
      return new FfmpegSink({
        outputPath: output,
        gif: true,
        ...(options?.durationSeconds !== undefined ? { durationSeconds: options.durationSeconds } : {}),
      })
  }
}

function toTerminalRasterOpts(t: TerminalExportGrid): TerminalRasterizeOptions {
  return {
    mode: t.mode,
    cellWidth: t.cellWidth,
    cellHeight: t.cellHeight,
    ...(t.sixelPixelScale !== undefined ? { sixelPixelScale: t.sixelPixelScale } : {}),
    ...(t.asciiFontPath !== undefined ? { asciiFontPath: t.asciiFontPath } : {}),
    ...(t.asciiFontFamily !== undefined ? { asciiFontFamily: t.asciiFontFamily } : {}),
  }
}

function wrapTerminalRaster(pool: BufferPool, inner: Sink, grid: TerminalExportGrid): Sink {
  return new TerminalRasterSink(inner, pool, toTerminalRasterOpts(grid))
}

function validateTerminalExport(opts: ExportOptions): void {
  const t = opts.terminal
  if (!t) return
  if (t.cols < 1 || t.rows < 1) {
    throw new Error('terminal export: cols and rows must be >= 1')
  }
  if (t.cellWidth < 1 || t.cellHeight < 1) {
    throw new Error('terminal export: cellWidth and cellHeight must be >= 1')
  }
}

async function exportDemo(
  demoPath: string,
  demo: Demo,
  opts: ExportOptions,
  sink: Sink,
  pool: BufferPool,
): Promise<number> {
  const loader = new SceneLoader()
  const sinkId = opts.terminal ? 'terminal' : 'export'
  const runtimeDocument = await loadExportDemoRuntime(loader, demoPath, demo, sinkId)
  const { sections, fps, resolution } = runtimeDocument
  const grid = opts.terminal ? terminalResolutionFromGrid(opts.terminal.mode, opts.terminal.cols, opts.terminal.rows) : null

  const ctx: NodeContext = {
    canvas: null, ctx2d: null, gl: null,
    pool,
    width: grid?.width ?? resolution.width,
    height: grid?.height ?? resolution.height,
  }
  for (const s of sections) {
    ctx.assets = s.runtime.assets
    s.runtime.executor.init(ctx)
  }
  await sink.init(ctx.width, ctx.height, fps)

  let frame = 0
  let framesRendered = 0
  const lastEnd = sections[sections.length - 1]?.end ?? 0
  const maxFrames = opts.maxFrames ?? Infinity
  const capByDemoEnd = !Number.isFinite(maxFrames)

  while (frame < maxFrames) {
    const rawT = frame / fps
    if (capByDemoEnd && rawT >= lastEnd) break
    const t = !capByDemoEnd && rawT >= lastEnd ? Math.max(0, lastEnd - 1e-6) : rawT
    const dt = frame === 0 ? 0 : 1 / fps
    const rendered = renderDemoRuntimeFrame(runtimeDocument, {
      pool,
      ctx,
      t,
      frame,
      dt,
      options: { strictErrors: true },
    })
    if (!rendered) break
    await sink.write(rendered.buffer, frame, rendered.signal)
    pool.release(rendered.buffer)
    frame++
    framesRendered++
  }

  return framesRendered
}

export async function exportScene(scenePath: string, opts: ExportOptions): Promise<void> {
  validateTerminalExport(opts)
  const loader = new SceneLoader()
  const loaded = await loader.loadAnyFile(scenePath)

  const audioAndDuration =
    loaded.kind === 'demo'
      ? await (async () => {
        const { sections } = await loadExportDemoRuntime(
          loader,
          scenePath,
          loaded.demo,
          opts.terminal ? 'terminal' : 'export',
        )
        const durationSeconds = sections[sections.length - 1]?.end ?? 0
        return {
          audioTracks: buildDemoExportAudioTracks(loader, scenePath, loaded.demo, sections),
          durationSeconds,
        }
      })()
      : {
          audioTracks: buildSceneExportAudioTracks(loader, scenePath, loaded.scene),
          durationSeconds: loaded.scene.duration,
        }

  const pool = new BufferPoolImpl()
  const innerSink = createExportSink(opts.kind, opts.output, {
    audioTracks: audioAndDuration.audioTracks,
    durationSeconds: audioAndDuration.durationSeconds,
  })

  const rasterSink = opts.terminal ? wrapTerminalRaster(pool, innerSink, opts.terminal) : innerSink
  const sink = opts.onFrame ? withProgress(rasterSink, opts.onFrame) : rasterSink

  // A failed (or stopped) export still closes the sink, so ffmpeg is not left waiting for frames.
  const framesRendered = await renderAll().catch(async (error: unknown) => {
    await sink.flush().catch(() => {})
    throw error
  })
  async function renderAll(): Promise<number> {
    return loaded.kind === 'demo'
      ? await exportDemo(scenePath, loaded.demo, opts, sink, pool)
      : await (async () => {
          const scene = loaded.scene
          const runtime = await createSceneRuntime(scene, {
            sinkId: opts.terminal ? 'terminal' : 'export',
            buildRegistry,
            assetManager: {
              resolveAssetUrl(url) {
                if (/^([a-z]+:)?\/\//i.test(url) || url.startsWith('overscan://')) return url
                return loader.resolveScenePath(scenePath, url)
              },
              loadText(path) {
                return readFile(path, 'utf8')
              },
              loadBinary(path) {
                return readFile(path)
              },
            },
          })
          const grid = opts.terminal
            ? terminalResolutionFromGrid(opts.terminal.mode, opts.terminal.cols, opts.terminal.rows)
            : null
          const ctx: NodeContext = {
            canvas: null, ctx2d: null, gl: null,
            assets: runtime.assets,
            pool,
            width: grid?.width ?? scene.resolution.width,
            height: grid?.height ?? scene.resolution.height,
          }
          await sink.init(ctx.width, ctx.height, scene.fps)
          runtime.executor.init(ctx)
          const outputNodeId = opts.terminal ? runtime.outputNodeId : resolveExportOutputNodeId(scene)
          const { framesRendered } = await renderLoop({
            scene,
            pool,
            timeline: runtime.timeline,
            executor: runtime.executor,
            ctx,
            sink,
            outputNodeId,
            maxFrames: opts.maxFrames ?? Infinity,
            syntheticTimeline: true,
            strictErrors: true,
          })
          return framesRendered
        })()
  }

  await sink.flush()

  if (process.env['DEMO_SILENT_EXIT'] !== '1') {
    console.error(
      `[demo] export kind=${opts.kind}${opts.terminal ? ' terminal=1' : ''} frames=${framesRendered} path=${opts.output}`,
    )
  }
}

async function loadExportDemoRuntime(
  loader: SceneLoader,
  demoPath: string,
  demo: Demo,
  sinkId: 'export' | 'terminal',
): Promise<DemoRuntimeDocument> {
  return createDemoRuntimeDocument(demo, {
    sinkId,
    buildRegistry,
    assetManager: fileAssetOptions(loader, demoPath),
    // Each section's relative assets (shaders, textures) resolve against its own scene file.
    sectionAssetManager: scenePath => fileAssetOptions(loader, scenePath),
    async loadSection(rawScenePath) {
      const scenePath = loader.resolveScenePath(demoPath, rawScenePath)
      const scene = await loader.loadFile(scenePath)
      return { scene, scenePath }
    },
  })
}

function buildSceneExportAudioTracks(loader: SceneLoader, scenePath: string, scene: Scene): FfmpegAudioTrack[] {
  if (!scene.audio) return []
  const source = typeof scene.audio === 'string' ? scene.audio : scene.audio.src
  return [{
    inputPath: loader.resolveScenePath(scenePath, source),
    trimSeconds: scene.duration,
  }]
}

function buildDemoExportAudioTracks(
  loader: SceneLoader,
  demoPath: string,
  demo: Demo,
  sections: DemoRuntimeDocument['sections'],
): FfmpegAudioTrack[] {
  const tracks: FfmpegAudioTrack[] = []
  const durationSeconds = sections[sections.length - 1]?.end ?? 0
  if (demo.audio) {
    const source = typeof demo.audio === 'string' ? demo.audio : demo.audio.src
    tracks.push({
      inputPath: loader.resolveScenePath(demoPath, source),
      trimSeconds: durationSeconds,
      loop: demo.loop ?? false,
    })
  }
  for (const section of sections) {
    const audio = section.runtime.scene.audio
    if (!audio) continue
    const source = typeof audio === 'string' ? audio : audio.src
    tracks.push({
      inputPath: loader.resolveScenePath(section.scenePath, source),
      offsetSeconds: section.start,
      trimSeconds: section.end - section.start,
    })
  }
  return tracks
}
