import { requireGlObject } from '@overscan/types'
import type { BufferPool, FrameBuffer } from '@overscan/types'

interface PoolEntry {
  buffer: FrameBuffer
  refCount: number
  inUse: boolean
}

function createTexture(gl: WebGL2RenderingContext, width: number, height: number): WebGLTexture {
  const tex = requireGlObject(gl.createTexture(), 'WebglBufferPool: createTexture failed')
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
  return tex
}

function createFramebuffer(gl: WebGL2RenderingContext, texture: WebGLTexture): WebGLFramebuffer {
  const fbo = requireGlObject(gl.createFramebuffer(), 'WebglBufferPool: createFramebuffer failed')
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
  return fbo
}

export class WebglBufferPool implements BufferPool {
  private readonly entries = new Map<string, PoolEntry>()
  private nextId = 0

  constructor(private readonly gl: WebGL2RenderingContext) {}

  acquire(width: number, height: number): FrameBuffer {
    for (const entry of this.entries.values()) {
      if (!entry.inUse && entry.buffer.width === width && entry.buffer.height === height) {
        entry.inUse = true
        entry.refCount = 1
        entry.buffer.clear()
        return entry.buffer
      }
    }

    const id = `gl-buf-${this.nextId++}`
    const texture = createTexture(this.gl, width, height)
    const fbo = createFramebuffer(this.gl, texture)
    const data = new Uint8ClampedArray(width * height * 4)
    const buffer: FrameBuffer = {
      id,
      width,
      height,
      data,
      texture,
      fbo,
      clear: () => {
        data.fill(0)
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, fbo)
        this.gl.viewport(0, 0, width, height)
        this.gl.clearColor(0, 0, 0, 0)
        this.gl.clear(this.gl.COLOR_BUFFER_BIT)
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
