import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Generator,
  type NodeContext,
  type Signal,
} from '@overscan/types'
import { scaleThickness } from '../../viewport-scale.js'

export interface ShadebobsConfig {
  count?: number
  radius?: AnimatableFloat
  freqX?: AnimatableFloat
  freqY?: AnimatableFloat
  amplitude?: AnimatableFloat
  decay?: AnimatableFloat
  intensity?: AnimatableFloat
  phaseSpread?: number
  backgroundColor?: string
  palette?: number[][]
}

const DEFAULT_PALETTE = [
  [22, 10, 36],
  [90, 28, 128],
  [255, 76, 168],
  [255, 220, 116],
  [255, 255, 255],
]

export function ShadebobsGenerator(config: Partial<ShadebobsConfig> = {}): Generator {
  const count = Math.max(1, Math.min(48, Math.round(config.count ?? 10)))
  const radiusRef = config.radius ?? 22
  const freqXRef = config.freqX ?? 1.2
  const freqYRef = config.freqY ?? 1.8
  const amplitudeRef = config.amplitude ?? 0.34
  const decayRef = config.decay ?? 0.88
  const intensityRef = config.intensity ?? 0.22
  const phaseSpread = config.phaseSpread ?? 0.8
  const background = hexToRgb(config.backgroundColor ?? '#05060d')
  const palette = config.palette ?? DEFAULT_PALETTE
  let field: Float32Array | null = null
  let fw = 0
  let fh = 0
  let program: WebGLProgram | null = null
  let vao: WebGLVertexArrayObject | null = null
  let uResolution: WebGLUniformLocation | null = null
  let uTime: WebGLUniformLocation | null = null
  let uCount: WebGLUniformLocation | null = null
  let uRadius: WebGLUniformLocation | null = null
  let uFreq: WebGLUniformLocation | null = null
  let uAmplitude: WebGLUniformLocation | null = null
  let uDecay: WebGLUniformLocation | null = null
  let uIntensity: WebGLUniformLocation | null = null
  let uPhaseSpread: WebGLUniformLocation | null = null
  let uBackground: WebGLUniformLocation | null = null
  let uPaletteCount: WebGLUniformLocation | null = null
  let uPalette0: WebGLUniformLocation | null = null

  function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type)
    if (!shader) throw new Error('ShadebobsGenerator: createShader failed')
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? 'compile failed'
      gl.deleteShader(shader)
      throw new Error(`ShadebobsGenerator: ${log}`)
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
uniform float u_count;
uniform float u_radius;
uniform vec2 u_freq;
uniform float u_amplitude;
uniform float u_decay;
uniform float u_intensity;
uniform float u_phaseSpread;
uniform vec3 u_background;
uniform float u_paletteCount;
uniform vec3 u_palette[8];
out vec4 fragColor;

vec3 paletteSample(float t) {
  float count = max(2.0, u_paletteCount);
  float scaled = clamp(t, 0.0, 1.0) * (count - 1.0);
  float idx = floor(scaled);
  float nextIdx = min(count - 1.0, idx + 1.0);
  return mix(u_palette[int(idx)], u_palette[int(nextIdx)], fract(scaled));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float field = 0.0;
  for (float i = 0.0; i < 48.0; i += 1.0) {
    if (i >= u_count) break;
    float phase = i * u_phaseSpread;
    vec2 center = vec2(
      0.5 + sin(u_time * u_freq.x + phase) * u_amplitude,
      0.5 + sin(u_time * u_freq.y + phase * 1.31) * u_amplitude * 0.72
    );
    vec2 d = (uv - center) * u_resolution / max(u_radius, 1.0);
    float r2 = dot(d, d);
    if (r2 <= 1.0) field += (1.0 - r2) * u_intensity;
  }
  field *= 1.0 / max(0.08, 1.0 - clamp(u_decay, 0.0, 0.995));
  float value = clamp(field, 0.0, 1.0);
  vec3 col = mix(u_background, paletteSample(value), smoothstep(0.02, 1.0, value));
  fragColor = vec4(col, 1.0);
}`
    const vs = compile(gl, gl.VERTEX_SHADER, vert)
    const fs = compile(gl, gl.FRAGMENT_SHADER, frag)
    const prog = gl.createProgram()
    if (!prog) throw new Error('ShadebobsGenerator: createProgram failed')
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog) ?? 'link failed'
      gl.deleteProgram(prog)
      throw new Error(`ShadebobsGenerator: ${log}`)
    }
    const quad = gl.createBuffer()
    const vaoObj = gl.createVertexArray()
    if (!quad || !vaoObj) throw new Error('ShadebobsGenerator: quad init failed')
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
    uCount = gl.getUniformLocation(prog, 'u_count')
    uRadius = gl.getUniformLocation(prog, 'u_radius')
    uFreq = gl.getUniformLocation(prog, 'u_freq')
    uAmplitude = gl.getUniformLocation(prog, 'u_amplitude')
    uDecay = gl.getUniformLocation(prog, 'u_decay')
    uIntensity = gl.getUniformLocation(prog, 'u_intensity')
    uPhaseSpread = gl.getUniformLocation(prog, 'u_phaseSpread')
    uBackground = gl.getUniformLocation(prog, 'u_background')
    uPaletteCount = gl.getUniformLocation(prog, 'u_paletteCount')
    uPalette0 = gl.getUniformLocation(prog, 'u_palette[0]')
  }

  function ensureField(w: number, h: number): Float32Array {
    if (!field || fw !== w || fh !== h) {
      field = new Float32Array(w * h)
      fw = w
      fh = h
    }
    return field
  }

  return {
    type: 'generator',
    id: 'shadebobs',
    renderers: ['gpu', 'cpu'],
    config: config as Generator['config'],
    init(ctx) {
      ensureGpu(ctx)
      field = null
      fw = 0
      fh = 0
    },
    render(ctx: NodeContext, out: FrameBuffer, signal: Signal): void {
      const { width: rw, height: rh } = out
      const radius = scaleThickness(Math.max(2, resolveAnimatableFloat(radiusRef, signal)), rw, rh)
      const freqX = resolveAnimatableFloat(freqXRef, signal)
      const freqY = resolveAnimatableFloat(freqYRef, signal)
      const amplitude = Math.max(0, Math.min(0.48, resolveAnimatableFloat(amplitudeRef, signal)))
      const decay = Math.max(0, Math.min(0.995, resolveAnimatableFloat(decayRef, signal)))
      const intensity = Math.max(0.01, Math.min(1, resolveAnimatableFloat(intensityRef, signal)))
      if (ctx.gl && out.fbo && program && vao) {
        const gl = ctx.gl
        gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo)
        gl.viewport(0, 0, out.width, out.height)
        gl.useProgram(program)
        gl.bindVertexArray(vao)
        gl.uniform2f(uResolution, out.width, out.height)
        gl.uniform1f(uTime, signal.t)
        gl.uniform1f(uCount, count)
        gl.uniform1f(uRadius, Math.max(1, radius))
        gl.uniform2f(uFreq, freqX, freqY)
        gl.uniform1f(uAmplitude, amplitude)
        gl.uniform1f(uDecay, decay)
        gl.uniform1f(uIntensity, intensity)
        gl.uniform1f(uPhaseSpread, phaseSpread)
        gl.uniform3f(uBackground, background[0] / 255, background[1] / 255, background[2] / 255)
        gl.uniform1f(uPaletteCount, Math.min(palette.length, 8))
        const flat = new Float32Array(24)
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
      const rCpu = Math.max(1, radius)
      const accum = ensureField(w, h)
      for (let i = 0; i < accum.length; i++) accum[i] = (accum[i] ?? 0) * decay
      const rx = w * amplitude
      const ry = h * amplitude * 0.72
      for (let i = 0; i < count; i++) {
        const phase = i * phaseSpread
        const x = w * 0.5 + Math.sin(signal.t * freqX + phase) * rx
        const y = h * 0.5 + Math.sin(signal.t * freqY + phase * 1.31) * ry
        stampBob(accum, w, h, x, y, rCpu, intensity)
      }
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = y * w + x
          const value = Math.max(0, Math.min(1, accum[idx]!))
          const color = value <= 0.001 ? background : mixRgb(background, samplePalette(palette, value), smoothstep(0.02, 1, value))
          const o = idx * 4
          data[o] = color[0]
          data[o + 1] = color[1]
          data[o + 2] = color[2]
          data[o + 3] = 255
        }
      }
    },
    destroy() {
      field = null
      fw = 0
      fh = 0
      program = null
      vao = null
      uResolution = null
      uTime = null
      uCount = null
      uRadius = null
      uFreq = null
      uAmplitude = null
      uDecay = null
      uIntensity = null
      uPhaseSpread = null
      uBackground = null
      uPaletteCount = null
      uPalette0 = null
    },
  }
}

function stampBob(
  accum: Float32Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  radius: number,
  intensity: number,
): void {
  const r = Math.max(1, Math.round(radius))
  const minX = Math.max(0, Math.floor(cx - r))
  const maxX = Math.min(w - 1, Math.ceil(cx + r))
  const minY = Math.max(0, Math.floor(cy - r))
  const maxY = Math.min(h - 1, Math.ceil(cy + r))
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = (x - cx) / Math.max(1, radius)
      const dy = (y - cy) / Math.max(1, radius)
      const d2 = dx * dx + dy * dy
      if (d2 > 1) continue
      accum[y * w + x] = Math.min(1.4, accum[y * w + x]! + (1 - d2) * intensity)
    }
  }
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

function mixRgb(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  return [
    Math.round(a[0] + (b[0] - a[0]) * x),
    Math.round(a[1] + (b[1] - a[1]) * x),
    Math.round(a[2] + (b[2] - a[2]) * x),
  ]
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / Math.max(0.0001, b - a)))
  return t * t * (3 - 2 * t)
}

function hexToRgb(hex: string): [number, number, number] {
  const s = hex.replace('#', '')
  const n = parseInt(s.length === 3 ? s.split('').map(c => c + c).join('') : s, 16)
  return [
    Number.isFinite(n) ? (n >> 16) & 0xff : 0,
    Number.isFinite(n) ? (n >> 8) & 0xff : 0,
    Number.isFinite(n) ? n & 0xff : 0,
  ]
}
