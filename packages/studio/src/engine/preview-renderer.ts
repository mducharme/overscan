import type { BufferPool, FrameBuffer, NodeContext, Signal } from '@overscan/types'
import { BufferPoolBrowser, WebglBufferPool } from '@overscan/core/browser'
import { Canvas2dDisplaySink, WebglDisplaySink } from '@overscan/sink-browser'
import { sampleAsciiCell } from '@overscan/terminal-cells'
import type { Renderer, RenderScale } from '../state/store'
import type { Player } from './player'

/** Terminal cell size in CSS pixels for the ASCII/ANSI previews (a typical 8×16 terminal font). */
export const CELL_W = 8
export const CELL_H = 16

export interface PreviewRenderer {
  readonly mode: Renderer
  /** Frame resolution the player renders at. */
  readonly renderSize: { width: number; height: number }
  /** CSS size the canvas should be shown at (terminal modes); null = fit to the available space. */
  readonly displaySize: { width: number; height: number } | null
  /** Renders and shows time `t`. Throws when a node fails. */
  render(t: number, dt: number): void
  destroy(): void
}

export interface PreviewOptions {
  mode: Renderer
  scale: RenderScale
  /** Space available for the preview, in CSS pixels (used to size the terminal grid). */
  viewport: { width: number; height: number }
}

/** Terminal grid that fits the viewport, like a terminal window of that size. */
export function terminalGrid(viewport: { width: number; height: number }): { cols: number; rows: number } {
  return {
    cols: Math.max(20, Math.floor(viewport.width / CELL_W)),
    rows: Math.max(8, Math.floor(viewport.height / CELL_H)),
  }
}

/** Creates the renderer for one mode on a fresh canvas. Re-create it when the mode, size or document changes. */
export async function createPreviewRenderer(canvas: HTMLCanvasElement, player: Player, options: PreviewOptions): Promise<PreviewRenderer> {
  const { mode, scale } = options
  const grid = terminalGrid(options.viewport)
  const renderSize = mode === 'ansi'
    ? { width: grid.cols, height: grid.rows * 2 }
    : mode === 'ascii'
      ? { width: grid.cols, height: grid.rows }
      : {
          width: Math.max(1, Math.round(player.resolution.width * scale)),
          height: Math.max(1, Math.round(player.resolution.height * scale)),
        }

  let pool: BufferPool
  let gl: WebGL2RenderingContext | null = null
  let show: (frame: FrameBuffer, signal: Signal) => Promise<void> | void
  let teardown = (): void => {}

  if (mode === 'gl') {
    const sink = new WebglDisplaySink(canvas)
    await sink.init(renderSize.width, renderSize.height, player.fps)
    gl = sink.context
    pool = new WebglBufferPool(gl)
    show = (frame, signal) => sink.write(frame, 0, signal)
    teardown = () => { void sink.flush() }
  } else if (mode === '2d') {
    const sink = new Canvas2dDisplaySink(canvas)
    await sink.init(renderSize.width, renderSize.height, player.fps)
    pool = new BufferPoolBrowser()
    show = (frame, signal) => sink.write(frame, 0, signal)
  } else {
    pool = new BufferPoolBrowser()
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D is not available')
    if (mode === 'ansi') {
      // Half-block cells are two stacked pixels: draw the frame 1:1 and let CSS scale it up crisply.
      canvas.width = renderSize.width
      canvas.height = renderSize.height
      show = frame => { context.putImageData(new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height), 0, 0) }
    } else {
      const dpr = Math.min(2, globalThis.devicePixelRatio || 1)
      canvas.width = grid.cols * CELL_W * dpr
      canvas.height = grid.rows * CELL_H * dpr
      context.scale(dpr, dpr)
      context.font = `${CELL_H - 3}px ui-monospace, Menlo, monospace`
      context.textBaseline = 'top'
      show = frame => {
        context.fillStyle = '#000'
        context.fillRect(0, 0, grid.cols * CELL_W, grid.rows * CELL_H)
        for (let y = 0; y < frame.height; y++) {
          for (let x = 0; x < frame.width; x++) {
            const cell = sampleAsciiCell(frame, x, y)
            if (cell.ch === ' ') continue
            context.fillStyle = `rgb(${cell.r},${cell.g},${cell.b})`
            context.fillText(cell.ch, x * CELL_W, y * CELL_H + 1)
          }
        }
      }
    }
  }

  const ctx: NodeContext = { canvas: null, ctx2d: null, gl, pool, width: renderSize.width, height: renderSize.height }
  // Nodes cache GPU programs per context: reset them before preparing for this one.
  player.destroy()
  player.init(ctx)
  let frame = 0

  return {
    mode,
    renderSize,
    displaySize: mode === 'ansi' || mode === 'ascii' ? { width: grid.cols * CELL_W, height: grid.rows * CELL_H } : null,
    render(t, dt) {
      const rendered = player.render(pool, ctx, t, frame++, dt)
      if (!rendered) return
      try {
        // Sinks copy the pixels synchronously, so the buffer can go back to the pool right after.
        void show(rendered.buffer, rendered.signal)
      } finally {
        pool.release(rendered.buffer)
      }
    },
    destroy() {
      teardown()
    },
  }
}
