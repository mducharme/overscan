import type { BufferPool, FrameBuffer } from '@overscan/types'

interface PoolEntry {
  buffer: FrameBuffer
  refCount: number
  inUse: boolean
}

/** Browser-safe pool: RGBA via `Uint8ClampedArray` only (no node-canvas). */
export class BufferPoolBrowser implements BufferPool {
  private readonly entries = new Map<string, PoolEntry>()
  private nextId = 0

  acquire(width: number, height: number): FrameBuffer {
    for (const entry of this.entries.values()) {
      if (!entry.inUse && entry.buffer.width === width && entry.buffer.height === height) {
        entry.inUse = true
        entry.refCount = 1
        entry.buffer.clear()
        return entry.buffer
      }
    }
    const id = `buf-${this.nextId++}`
    const data = new Uint8ClampedArray(width * height * 4)
    const buffer: FrameBuffer = {
      id,
      width,
      height,
      data,
      clear() {
        this.data.fill(0)
      },
    }
    this.entries.set(id, { buffer, refCount: 1, inUse: true })
    return buffer
  }

  retain(buffer: FrameBuffer): void {
    const entry = this.entries.get(buffer.id)
    if (entry) entry.refCount++
  }

  release(buffer: FrameBuffer): void {
    const entry = this.entries.get(buffer.id)
    if (!entry) return
    entry.refCount--
    if (entry.refCount <= 0) {
      entry.inUse = false
      entry.refCount = 0
    }
  }
}
