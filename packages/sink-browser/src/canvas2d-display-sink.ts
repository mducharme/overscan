import type { FrameBuffer, Signal, Sink } from '@overscan/types'

/**
 * Browser Canvas 2D sink — live preview on an `HTMLCanvasElement`.
 * Matches Phase 3 plan: `@overscan/sink-browser` is for in-browser display (Vite + HMR), not file export.
 */
export class Canvas2dDisplaySink implements Sink {
  readonly id = 'browser'

  constructor(private readonly canvas: HTMLCanvasElement) {}

  async init(width: number, height: number, _fps: number): Promise<void> {
    this.canvas.width = width
    this.canvas.height = height
  }

  async write(frame: FrameBuffer, _frameIndex: number, _signal: Signal): Promise<void> {
    const w = this.canvas.width
    const h = this.canvas.height
    if (frame.width !== w || frame.height !== h) {
      throw new Error(`Canvas2dDisplaySink: frame ${frame.width}×${frame.height} ≠ canvas ${w}×${h}`)
    }
    const ctx = this.canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    const img = ctx.createImageData(w, h)
    img.data.set(frame.data)
    ctx.putImageData(img, 0, 0)
  }

  async flush(): Promise<void> {}
}
