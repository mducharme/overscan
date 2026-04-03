import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Generator,
  type NodeContext,
  type Signal,
} from '@overscan/types'
import { scaleVerticalPeriod } from '../../viewport-scale.js'

export interface CopperbarsConfig {
  palette?: number[][]
  speed?: AnimatableFloat
  barHeight?: AnimatableFloat
  smooth?: boolean
  count?: number
  alpha?: AnimatableFloat
}

const DEFAULT_PALETTE = [
  [255, 64, 64],
  [255, 170, 48],
  [255, 240, 96],
  [72, 225, 120],
  [72, 180, 255],
  [160, 96, 255],
]

export function CopperbarsGenerator(config: Partial<CopperbarsConfig> = {}): Generator {
  const palette = config.palette ?? DEFAULT_PALETTE
  const speedRef = config.speed ?? 1
  const barHeightRef = config.barHeight ?? 8
  const smooth = config.smooth ?? true
  const count = Math.max(2, Math.min(64, Math.round(config.count ?? 16)))
  const alphaRef = config.alpha ?? 1
  let program: WebGLProgram | null = null
  let vao: WebGLVertexArrayObject | null = null
  let uResolution: WebGLUniformLocation | null = null
  let uTime: WebGLUniformLocation | null = null
  let uBarHeight: WebGLUniformLocation | null = null
  let uSmooth: WebGLUniformLocation | null = null
  let uAlpha: WebGLUniformLocation | null = null
  let uPaletteCount: WebGLUniformLocation | null = null
  let uPalette0: WebGLUniformLocation | null = null

  function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type)
    if (!shader) throw new Error('CopperbarsGenerator: createShader failed')
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? 'compile failed'
      gl.deleteShader(shader)
      throw new Error(`CopperbarsGenerator: ${log}`)
    }
    return shader
  }

  function ensureGpu(ctx: NodeContext): void {
    const gl = ctx.gl
    if (!gl || program) return
    const vert = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`
    const frag = `#version 300 es
precision mediump float;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_barHeight;
uniform float u_smooth;
uniform float u_alpha;
uniform float u_paletteCount;
uniform vec3 u_palette[8];
out vec4 fragColor;
vec3 paletteSample(float t) {
  float count = max(2.0, u_paletteCount);
  float scaled = mod(max(t, 0.0), count);
  float idx = floor(scaled);
  float nextIdx = mod(idx + 1.0, count);
  float mixAmt = u_smooth > 0.5 ? fract(scaled) : 0.0;
  return mix(u_palette[int(idx)], u_palette[int(nextIdx)], mixAmt);
}
void main() {
  float row = gl_FragCoord.y + u_time;
  float bars = row / max(1.0, u_barHeight);
  float alpha = clamp(u_alpha, 0.0, 1.0);
  vec3 col = paletteSample(bars) * alpha;
  fragColor = vec4(col, alpha);
}`
    const vs = compile(gl, gl.VERTEX_SHADER, vert)
    const fs = compile(gl, gl.FRAGMENT_SHADER, frag)
    const prog = gl.createProgram()
    if (!prog) throw new Error('CopperbarsGenerator: createProgram failed')
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog) ?? 'link failed'
      gl.deleteProgram(prog)
      throw new Error(`CopperbarsGenerator: ${log}`)
    }
    const quad = gl.createBuffer()
    const vaoObj = gl.createVertexArray()
    if (!quad || !vaoObj) throw new Error('CopperbarsGenerator: quad init failed')
    gl.bindVertexArray(vaoObj)
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(prog, 'a_pos')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
    program = prog
    vao = vaoObj
    uResolution = gl.getUniformLocation(prog, 'u_resolution')
    uTime = gl.getUniformLocation(prog, 'u_time')
    uBarHeight = gl.getUniformLocation(prog, 'u_barHeight')
    uSmooth = gl.getUniformLocation(prog, 'u_smooth')
    uAlpha = gl.getUniformLocation(prog, 'u_alpha')
    uPaletteCount = gl.getUniformLocation(prog, 'u_paletteCount')
    uPalette0 = gl.getUniformLocation(prog, 'u_palette[0]')
  }

  return {
    type: 'generator',
    id: 'copperbars',
    renderers: ['gpu', 'cpu'],
    config: config as Generator['config'],
    init(ctx) { ensureGpu(ctx) },
    render(ctx: NodeContext, out: FrameBuffer, signal: Signal): void {
      const speed = resolveAnimatableFloat(speedRef, signal)
      const barHeight = scaleVerticalPeriod(
        Math.max(1, resolveAnimatableFloat(barHeightRef, signal)),
        out.height,
      )
      const alpha = Math.max(0, Math.min(1, resolveAnimatableFloat(alphaRef, signal)))
      const time = signal.t * speed * count
      if (ctx.gl && out.fbo && program && vao) {
        const gl = ctx.gl
        gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo)
        gl.viewport(0, 0, out.width, out.height)
        gl.useProgram(program)
        gl.bindVertexArray(vao)
        gl.uniform2f(uResolution, out.width, out.height)
        gl.uniform1f(uTime, time)
        gl.uniform1f(uBarHeight, barHeight)
        gl.uniform1f(uSmooth, smooth ? 1 : 0)
        gl.uniform1f(uAlpha, alpha)
        gl.uniform1f(uPaletteCount, Math.min(palette.length, 8))
        const flat = new Float32Array(8 * 3)
        for (let i = 0; i < 8; i++) {
          const c = palette[i % palette.length] ?? DEFAULT_PALETTE[i % DEFAULT_PALETTE.length]!
          flat[i * 3] = (c[0] ?? 0) / 255
          flat[i * 3 + 1] = (c[1] ?? 0) / 255
          flat[i * 3 + 2] = (c[2] ?? 0) / 255
        }
        if (uPalette0) gl.uniform3fv(uPalette0, flat)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        return
      }
      const { width: w, height: h, data } = out
      for (let y = 0; y < h; y++) {
        const bars = (y + time) / barHeight
        const c = samplePalette(palette, bars, smooth)
        for (let x = 0; x < w; x++) {
          const o = (y * w + x) * 4
          data[o] = Math.round(c[0] * alpha)
          data[o + 1] = Math.round(c[1] * alpha)
          data[o + 2] = Math.round(c[2] * alpha)
          data[o + 3] = Math.round(255 * alpha)
        }
      }
    },
    destroy() {
      program = null
      vao = null
      uResolution = null
      uTime = null
      uBarHeight = null
      uSmooth = null
      uAlpha = null
      uPaletteCount = null
      uPalette0 = null
    },
  }
}

function samplePalette(palette: number[][], value: number, smooth: boolean): [number, number, number] {
  const colors = palette.length > 1 ? palette : DEFAULT_PALETTE
  const idx = Math.floor(value)
  const a = colors[((idx % colors.length) + colors.length) % colors.length] ?? colors[0]!
  const b = colors[((idx + 1) % colors.length + colors.length) % colors.length] ?? a
  const t = smooth ? value - idx : 0
  return [
    Math.round((a[0] ?? 0) + ((b[0] ?? 0) - (a[0] ?? 0)) * t),
    Math.round((a[1] ?? 0) + ((b[1] ?? 0) - (a[1] ?? 0)) * t),
    Math.round((a[2] ?? 0) + ((b[2] ?? 0) - (a[2] ?? 0)) * t),
  ]
}
