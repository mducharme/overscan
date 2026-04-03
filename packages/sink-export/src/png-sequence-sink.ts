import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { FrameBuffer, Signal, Sink } from '@overscan/types'
import { writeRgbaPng } from './write-rgba-png.js'

export interface PngSequenceSinkOptions {
  outputDir: string
}

/** PNG sequence on disk — wraps node-canvas encode (Phase 3 export path). */
export class PngSequenceSink implements Sink {
  readonly id = 'export'

  private w = 0
  private h = 0
  private ready = false

  constructor(private readonly opts: PngSequenceSinkOptions) {}

  async init(width: number, height: number, _fps: number): Promise<void> {
    this.w = width
    this.h = height
    await mkdir(this.opts.outputDir, { recursive: true })
    this.ready = true
  }

  async write(frame: FrameBuffer, frameIndex: number, _signal: Signal): Promise<void> {
    if (!this.ready) throw new Error('PngSequenceSink not initialized')
    if (frame.width !== this.w || frame.height !== this.h) {
      throw new Error(`PngSequenceSink: frame ${frame.width}×${frame.height} ≠ ${this.w}×${this.h}`)
    }
    const name = `frame-${String(frameIndex).padStart(6, '0')}.png`
    await writeRgbaPng(join(this.opts.outputDir, name), this.w, this.h, frame.data)
  }

  async flush(): Promise<void> {}
}
