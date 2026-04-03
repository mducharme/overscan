import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { FrameBuffer, Signal, Sink } from '@overscan/types'
import { writeRgbaPng } from './write-rgba-png.js'

async function loadHeadlessGl(): Promise<
  (w: number, h: number) => WebGLRenderingContext & { destroy(): void }
> {
  try {
    const mod = await import('gl')
    return mod.default
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(
      `png-gl export needs the optional native "gl" package (optionalDependency). It is missing or failed to load: ${detail}. Use --png instead, or install build prerequisites for "gl" on this platform.`,
    )
  }
}

export interface WebglPngSequenceSinkOptions {
  outputDir: string
}

/**
 * Headless WebGL1 blit + PNG encode — optional CI check that GPU texture upload + GLSL path works.
 * Live browser preview uses `Canvas2dDisplaySink` / future twgl compositor (`@overscan/sink-browser`).
 */
const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main(void) {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`

const FRAG = `
precision mediump float;
uniform sampler2D u_tex;
varying vec2 v_uv;
void main(void) {
  vec4 c = texture2D(u_tex, vec2(v_uv.x, 1.0 - v_uv.y));
  // Straight alpha over black — never export transparent pixels
  gl_FragColor = vec4(c.rgb * c.a, 1.0);
}
`

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const sh = gl.createShader(type)
  if (!sh) throw new Error('createShader failed')
  gl.shaderSource(sh, source)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? 'compile failed'
    gl.deleteShader(sh)
    throw new Error(log)
  }
  return sh
}

function linkProgram(gl: WebGLRenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram {
  const prog = gl.createProgram()
  if (!prog) throw new Error('createProgram failed')
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog) ?? 'link failed'
    gl.deleteProgram(prog)
    throw new Error(log)
  }
  return prog
}

function flipGlReadPixelsToTopLeft(
  src: Uint8Array,
  width: number,
  height: number,
  dst: Uint8ClampedArray,
): void {
  const row = width * 4
  for (let y = 0; y < height; y++) {
    const srcY = height - 1 - y
    dst.set(src.subarray(srcY * row, (srcY + 1) * row), y * row)
  }
}

export class WebglPngSequenceSink implements Sink {
  readonly id = 'export'

  private w = 0
  private h = 0
  private ready = false
  private gl: (WebGLRenderingContext & { destroy(): void }) | null = null
  private program: WebGLProgram | null = null
  private tex: WebGLTexture | null = null
  private buf: WebGLBuffer | null = null
  private aPosLoc = -1
  private uTexLoc: WebGLUniformLocation | null = null
  private readBack: Uint8Array | null = null
  private flipped: Uint8ClampedArray | null = null

  constructor(private readonly opts: WebglPngSequenceSinkOptions) {}

  async init(width: number, height: number, _fps: number): Promise<void> {
    this.w = width
    this.h = height
    await mkdir(this.opts.outputDir, { recursive: true })

    const createContext = await loadHeadlessGl()
    const gl = createContext(width, height)
    this.gl = gl

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERT)
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG)
    const program = linkProgram(gl, vs, fs)
    this.program = program

    const aPosLoc = gl.getAttribLocation(program, 'a_pos')
    if (aPosLoc < 0) throw new Error('missing a_pos')
    this.aPosLoc = aPosLoc

    const uTex = gl.getUniformLocation(program, 'u_tex')
    if (!uTex) throw new Error('missing u_tex')
    this.uTexLoc = uTex

    const quad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])
    const buffer = gl.createBuffer()
    if (!buffer) throw new Error('createBuffer failed')
    this.buf = buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW)

    const tex = gl.createTexture()
    if (!tex) throw new Error('createTexture failed')
    this.tex = tex
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)

    this.readBack = new Uint8Array(width * height * 4)
    this.flipped = new Uint8ClampedArray(width * height * 4)

    this.ready = true
  }

  async write(frame: FrameBuffer, frameIndex: number, _signal: Signal): Promise<void> {
    if (!this.ready || !this.gl || !this.program || !this.tex || !this.buf || !this.readBack || !this.flipped) {
      throw new Error('WebglPngSequenceSink not initialized')
    }
    if (frame.width !== this.w || frame.height !== this.h) {
      throw new Error(`WebglPngSequenceSink: frame ${frame.width}×${frame.height} ≠ ${this.w}×${this.h}`)
    }

    const gl = this.gl
    gl.viewport(0, 0, this.w, this.h)
    gl.disable(gl.BLEND)
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      this.w,
      this.h,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      frame.data,
    )

    gl.useProgram(this.program)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf)
    gl.enableVertexAttribArray(this.aPosLoc)
    gl.vertexAttribPointer(this.aPosLoc, 2, gl.FLOAT, false, 0, 0)
    gl.uniform1i(this.uTexLoc, 0)

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

    gl.readPixels(0, 0, this.w, this.h, gl.RGBA, gl.UNSIGNED_BYTE, this.readBack)
    flipGlReadPixelsToTopLeft(this.readBack, this.w, this.h, this.flipped)

    const name = `frame-${String(frameIndex).padStart(6, '0')}.png`
    await writeRgbaPng(join(this.opts.outputDir, name), this.w, this.h, this.flipped)
  }

  async flush(): Promise<void> {
    if (this.gl) {
      this.gl.destroy()
      this.gl = null
    }
    this.program = null
    this.tex = null
    this.buf = null
    this.readBack = null
    this.flipped = null
    this.ready = false
  }
}
