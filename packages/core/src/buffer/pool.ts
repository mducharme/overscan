import { createRequire } from 'node:module'
import type { BufferPool, FrameBuffer } from '@overscan/types'

const require = createRequire(import.meta.url)

type CreateCanvas = (width: number, height: number) => {
  getContext: (id: '2d') => null | { createImageData: (w: number, h: number) => ImageData }
}

let createCanvas: CreateCanvas | null = null
try {
  createCanvas = (require('canvas') as { createCanvas: CreateCanvas }).createCanvas
} catch {
  createCanvas = null
}

/** RGBA backing: node-canvas ImageData in Node when `canvas` is installed, else a plain buffer. */
function allocRgbaPixels(width: number, height: number): Uint8ClampedArray {
  if (createCanvas) {
    const canvas = createCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (ctx) return ctx.createImageData(width, height).data
  }
  return new Uint8ClampedArray(width * height * 4)
}

interface PoolEntry {
  buffer: FrameBuffer
  refCount: number
  inUse: boolean
}

export class BufferPoolImpl implements BufferPool {
  private readonly entries = new Map<string, PoolEntry>()
  private nextId = 0

  acquire(width: number, height: number): FrameBuffer {
    // find a free buffer of matching dimensions
    for (const entry of this.entries.values()) {
      if (!entry.inUse && entry.buffer.width === width && entry.buffer.height === height) {
        entry.inUse = true
        entry.refCount = 1
        entry.buffer.clear()
        return entry.buffer
      }
    }
    // allocate new
    const id = `buf-${this.nextId++}`
    const data = allocRgbaPixels(width, height)
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

  get stats() {
    let inUse = 0
    let free = 0
    for (const e of this.entries.values()) {
      if (e.inUse) inUse++
      else free++
    }
    return { inUse, free, total: this.entries.size }
  }
}
