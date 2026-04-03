import type { BufferPool, FrameBuffer, Signal, Sink } from '@overscan/types'
import {
  rasterizeTerminalFrameToRgba,
  terminalRasterOutputDimensions,
  type TerminalRasterizeOptions,
} from './terminal-raster.js'

/**
 * Wraps a pixel sink (e.g. FfmpegSink, PngSequenceSink): each write receives a terminal-sized
 * {@link FrameBuffer}, rasterizes with node-canvas, then forwards RGBA at the upscaled size.
 */
export class TerminalRasterSink implements Sink {
  readonly id = 'export'

  private rasterW = 0
  private rasterH = 0

  constructor(
    private readonly inner: Sink,
    private readonly pool: BufferPool,
    private readonly rasterOpts: TerminalRasterizeOptions,
  ) {}

  async init(terminalFrameWidth: number, terminalFrameHeight: number, fps: number): Promise<void> {
    const { width, height } = terminalRasterOutputDimensions(
      this.rasterOpts.mode,
      terminalFrameWidth,
      terminalFrameHeight,
      this.rasterOpts.cellWidth,
      this.rasterOpts.cellHeight,
      this.rasterOpts.sixelPixelScale ?? 2,
    )
    this.rasterW = width
    this.rasterH = height
    await this.inner.init(width, height, fps)
  }

  async write(frame: FrameBuffer, frameIndex: number, signal: Signal): Promise<void> {
    const { width, height, data } = rasterizeTerminalFrameToRgba(frame, this.rasterOpts)
    if (width !== this.rasterW || height !== this.rasterH) {
      throw new Error(
        `TerminalRasterSink: raster size ${width}×${height} ≠ expected ${this.rasterW}×${this.rasterH}`,
      )
    }
    const out = this.pool.acquire(width, height)
    out.data.set(data)
    try {
      await this.inner.write(out, frameIndex, signal)
    } finally {
      this.pool.release(out)
    }
  }

  async flush(): Promise<void> {
    await this.inner.flush()
  }
}
