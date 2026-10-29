import { ASPECT_SCALE_GLSL, aspectScale } from '../../viewport-scale.js'
import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Generator,
  type NodeContext,
  type Signal,
} from '@overscan/types'
import { fastSin } from '../../fast-math.js'

export interface MoireConfig {
  mode?: 'grid' | 'rings' | 'radial'
  freq1?: AnimatableFloat
  freq2?: AnimatableFloat
  angle1?: AnimatableFloat
  angle2?: AnimatableFloat
  speed1?: AnimatableFloat
  speed2?: AnimatableFloat
  palette?: number[][]
  contrast?: AnimatableFloat
}

const DEFAULT_PALETTE = [
  [0, 0, 0],
  [255, 255, 255],
]

export function MoireGenerator(config: Partial<MoireConfig> = {}): Generator {
  const mode = config.mode ?? 'grid'
  const freq1Ref = config.freq1 ?? 20
  const freq2Ref = config.freq2 ?? 21
  const angle1Ref = config.angle1 ?? 0
  const angle2Ref = config.angle2 ?? 0.05
  const speed1Ref = config.speed1 ?? 0
  const speed2Ref = config.speed2 ?? 0
  const contrastRef = config.contrast ?? 1
  const palette = config.palette ?? DEFAULT_PALETTE
  let program: WebGLProgram | null = null
  let vao: WebGLVertexArrayObject | null = null
  let uResolution: WebGLUniformLocation | null = null
  let uFreq1: WebGLUniformLocation | null = null
  let uFreq2: WebGLUniformLocation | null = null
  let uAngle1: WebGLUniformLocation | null = null
  let uAngle2: WebGLUniformLocation | null = null
  let uTime1: WebGLUniformLocation | null = null
  let uTime2: WebGLUniformLocation | null = null
  let uContrast: WebGLUniformLocation | null = null
  let uMode: WebGLUniformLocation | null = null
  let uPaletteCount: WebGLUniformLocation | null = null
  let uPalette0: WebGLUniformLocation | null = null

  function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type)
    if (!shader) throw new Error('MoireGenerator: createShader failed')
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? 'compile failed'
      gl.deleteShader(shader)
      throw new Error(`MoireGenerator: ${log}`)
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
uniform float u_freq1;
uniform float u_freq2;
uniform float u_angle1;
uniform float u_angle2;
uniform float u_time1;
uniform float u_time2;
uniform float u_contrast;
uniform float u_mode;
uniform float u_paletteCount;
uniform vec3 u_palette[8];
out vec4 fragColor;
vec2 rot(vec2 p, float a) {
  float c = cos(a), s = sin(a);
  return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
}
vec3 paletteSample(float t) {
  float count = max(2.0, u_paletteCount);
  float scaled = clamp(t, 0.0, 1.0) * (count - 1.0);
  float idx = floor(scaled);
  float nextIdx = min(count - 1.0, idx + 1.0);
  return mix(u_palette[int(idx)], u_palette[int(nextIdx)], fract(scaled));
}
float pattern(vec2 p, float freq, float angle, float time, float mode) {
  vec2 q = rot(p, angle);
  if (mode < 0.5) {
    return sin(q.x * freq + time) * sin(q.y * freq + time);
  }
  if (mode < 1.5) {
    return sin(length(q) * freq - time);
  }
  float r = atan(q.y, q.x);
  return sin(r * freq + time) * sin(length(q) * freq * 0.6 - time);
}
${ASPECT_SCALE_GLSL}
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 p = (uv - 0.5) * 2.0 * aspectScale(u_resolution);
  float a = pattern(p, u_freq1, u_angle1, u_time1, u_mode);
  float b = pattern(p, u_freq2, u_angle2, u_time2, u_mode);
  float v = 0.5 + 0.5 * clamp(a * b * u_contrast, -1.0, 1.0);
  fragColor = vec4(paletteSample(v), 1.0);
}`
    const vs = compile(gl, gl.VERTEX_SHADER, vert)
    const fs = compile(gl, gl.FRAGMENT_SHADER, frag)
    const prog = gl.createProgram()
    if (!prog) throw new Error('MoireGenerator: createProgram failed')
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog) ?? 'link failed'
      gl.deleteProgram(prog)
      throw new Error(`MoireGenerator: ${log}`)
    }
    const quad = gl.createBuffer()
    const vaoObj = gl.createVertexArray()
    if (!quad || !vaoObj) throw new Error('MoireGenerator: quad init failed')
    gl.bindVertexArray(vaoObj)
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(prog, 'a_pos')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
    program = prog
    vao = vaoObj
    uResolution = gl.getUniformLocation(prog, 'u_resolution')
    uFreq1 = gl.getUniformLocation(prog, 'u_freq1')
    uFreq2 = gl.getUniformLocation(prog, 'u_freq2')
    uAngle1 = gl.getUniformLocation(prog, 'u_angle1')
    uAngle2 = gl.getUniformLocation(prog, 'u_angle2')
    uTime1 = gl.getUniformLocation(prog, 'u_time1')
    uTime2 = gl.getUniformLocation(prog, 'u_time2')
    uContrast = gl.getUniformLocation(prog, 'u_contrast')
    uMode = gl.getUniformLocation(prog, 'u_mode')
    uPaletteCount = gl.getUniformLocation(prog, 'u_paletteCount')
    uPalette0 = gl.getUniformLocation(prog, 'u_palette[0]')
  }

  return {
    type: 'generator',
    id: 'moire',
    renderers: ['gpu', 'cpu'],
    config: config as Generator['config'],
    init(ctx: NodeContext) {
      ensureGpu(ctx)
    },
    render(ctx: NodeContext, out: FrameBuffer, signal: Signal): void {
      const freq1 = resolveAnimatableFloat(freq1Ref, signal)
      const freq2 = resolveAnimatableFloat(freq2Ref, signal)
      const angle1 = resolveAnimatableFloat(angle1Ref, signal)
      const angle2 = resolveAnimatableFloat(angle2Ref, signal)
      const time1 = resolveAnimatableFloat(speed1Ref, signal) * signal.t
      const time2 = resolveAnimatableFloat(speed2Ref, signal) * signal.t
      const contrast = Math.max(0.1, resolveAnimatableFloat(contrastRef, signal))
      if (ctx.gl && out.fbo && program && vao) {
        const gl = ctx.gl
        gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo)
        gl.viewport(0, 0, out.width, out.height)
        gl.useProgram(program)
        gl.bindVertexArray(vao)
        gl.uniform2f(uResolution, out.width, out.height)
        gl.uniform1f(uFreq1, freq1)
        gl.uniform1f(uFreq2, freq2)
        gl.uniform1f(uAngle1, angle1)
        gl.uniform1f(uAngle2, angle2)
        gl.uniform1f(uTime1, time1)
        gl.uniform1f(uTime2, time2)
        gl.uniform1f(uContrast, contrast)
        gl.uniform1f(uMode, mode === 'rings' ? 1 : mode === 'radial' ? 2 : 0)
        gl.uniform1f(uPaletteCount, Math.min(palette.length, 8))
        const flat = new Float32Array(8 * 3)
        for (let i = 0; i < 8; i++) {
          const c = palette[i] ?? palette[palette.length - 1] ?? DEFAULT_PALETTE[DEFAULT_PALETTE.length - 1]!
          flat[i * 3 + 0] = (c[0] ?? 0) / 255
          flat[i * 3 + 1] = (c[1] ?? 0) / 255
          flat[i * 3 + 2] = (c[2] ?? 0) / 255
        }
        if (uPalette0) gl.uniform3fv(uPalette0, flat)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        return
      }

      const { width: w, height: h, data } = out
      const aspect = aspectScale(w, h)
      const c1 = Math.cos(angle1)
      const s1 = Math.sin(angle1)
      const c2 = Math.cos(angle2)
      const s2 = Math.sin(angle2)
      for (let y = 0; y < h; y++) {
        const uvy = y / Math.max(1, h - 1)
        const py = (uvy - 0.5) * 2 * aspect.y
        for (let x = 0; x < w; x++) {
          const uvx = x / Math.max(1, w - 1)
          const px = (uvx - 0.5) * 2 * aspect.x
          const a = samplePattern(px, py, freq1, c1, s1, time1, mode)
          const b = samplePattern(px, py, freq2, c2, s2, time2, mode)
          const v = 0.5 + 0.5 * Math.max(-1, Math.min(1, a * b * contrast))
          const c = samplePalette(palette, v)
          const o = (y * w + x) * 4
          data[o] = c[0]
          data[o + 1] = c[1]
          data[o + 2] = c[2]
          data[o + 3] = 255
        }
      }
    },
    destroy() {
      program = null
      vao = null
      uResolution = null
      uFreq1 = null
      uFreq2 = null
      uAngle1 = null
      uAngle2 = null
      uTime1 = null
      uTime2 = null
      uContrast = null
      uMode = null
      uPaletteCount = null
      uPalette0 = null
    },
  }
}

function samplePattern(
  px: number,
  py: number,
  freq: number,
  c: number,
  s: number,
  time: number,
  mode: NonNullable<MoireConfig['mode']>,
): number {
  const qx = px * c - py * s
  const qy = px * s + py * c
  if (mode === 'rings') return fastSin(Math.sqrt(qx * qx + qy * qy) * freq - time)
  if (mode === 'radial') return fastSin(Math.atan2(qy, qx) * freq + time) * fastSin(Math.sqrt(qx * qx + qy * qy) * freq * 0.6 - time)
  return fastSin(qx * freq + time) * fastSin(qy * freq + time)
}

function samplePalette(palette: number[][], t: number): [number, number, number] {
  const colors = palette.length > 1 ? palette : DEFAULT_PALETTE
  const scaled = Math.max(0, Math.min(1, t)) * (colors.length - 1)
  const idx = Math.min(colors.length - 2, Math.floor(scaled))
  const frac = scaled - idx
  const a = colors[idx] ?? colors[0] ?? DEFAULT_PALETTE[0]!
  const b = colors[idx + 1] ?? a
  return [
    Math.round((a[0] ?? 0) + ((b[0] ?? 0) - (a[0] ?? 0)) * frac),
    Math.round((a[1] ?? 0) + ((b[1] ?? 0) - (a[1] ?? 0)) * frac),
    Math.round((a[2] ?? 0) + ((b[2] ?? 0) - (a[2] ?? 0)) * frac),
  ]
}
