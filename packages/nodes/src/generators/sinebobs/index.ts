import { frameSteps } from '../../frame-time.js'
import {
  requireGlObject,
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Generator,
  type NodeContext,
  type Signal,
} from '@overscan/types'
import { scaleThickness } from '../../viewport-scale.js'

export interface SinebobsConfig {
  count?: number
  radius?: AnimatableFloat
  freqX?: AnimatableFloat
  freqY?: AnimatableFloat
  amplitude?: AnimatableFloat
  palette?: number[][]
  sprite?: 'circle' | 'star' | 'diamond' | string
  trail?: AnimatableFloat
  phaseSpread?: number
}

const DEFAULT_PALETTE = [
  [255, 96, 64],
  [255, 220, 96],
  [96, 255, 160],
  [96, 180, 255],
  [214, 120, 255],
]

export function SinebobsGenerator(config: Partial<SinebobsConfig> = {}): Generator {
  const count = Math.max(1, Math.min(64, Math.round(config.count ?? 16)))
  const radiusRef = config.radius ?? 20
  const freqXRef = config.freqX ?? 1
  const freqYRef = config.freqY ?? 1.3
  const amplitudeRef = config.amplitude ?? 0.4
  const trailRef = config.trail ?? 0
  const phaseSpread = config.phaseSpread ?? 1
  const sprite = config.sprite ?? 'circle'
  const palette = config.palette ?? DEFAULT_PALETTE
  let program: WebGLProgram | null = null
  let vao: WebGLVertexArrayObject | null = null
  let uResolution: WebGLUniformLocation | null = null
  let uTime: WebGLUniformLocation | null = null
  let uCount: WebGLUniformLocation | null = null
  let uRadius: WebGLUniformLocation | null = null
  let uFreq: WebGLUniformLocation | null = null
  let uAmplitude: WebGLUniformLocation | null = null
  let uPhaseSpread: WebGLUniformLocation | null = null
  let uSprite: WebGLUniformLocation | null = null
  let uPaletteCount: WebGLUniformLocation | null = null
  let uPalette0: WebGLUniformLocation | null = null

  function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type)
    if (!shader) throw new Error('SinebobsGenerator: createShader failed')
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? 'compile failed'
      gl.deleteShader(shader)
      throw new Error(`SinebobsGenerator: ${log}`)
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
uniform float u_phaseSpread;
uniform float u_sprite;
uniform float u_paletteCount;
uniform vec3 u_palette[8];
out vec4 fragColor;
vec3 paletteSample(float t) {
  float count = max(2.0, u_paletteCount);
  float scaled = fract(t) * (count - 1.0);
  float idx = floor(scaled);
  float nextIdx = min(count - 1.0, idx + 1.0);
  return mix(u_palette[int(idx)], u_palette[int(nextIdx)], fract(scaled));
}
float shape(vec2 p, float sprite) {
  if (sprite < 0.5) return 1.0 - length(p);
  if (sprite < 1.5) {
    float a = atan(p.y, p.x);
    float r = 0.42 + 0.18 * cos(a * 5.0);
    return r - length(p);
  }
  return 0.6 - (abs(p.x) + abs(p.y));
}
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec3 col = vec3(0.0);
  for (float i = 0.0; i < 64.0; i += 1.0) {
    if (i >= u_count) break;
    float phase = i * u_phaseSpread;
    vec2 center = vec2(
      0.5 + sin(u_time * u_freq.x + phase) * u_amplitude,
      0.5 + sin(u_time * u_freq.y + phase * 1.37) * u_amplitude * 0.72
    );
    vec2 p = (uv - center) * u_resolution / max(u_radius, 1.0);
    float s = smoothstep(0.08, -0.08, shape(p, u_sprite));
    col += paletteSample(i / max(1.0, u_count - 1.0)) * s;
  }
  fragColor = vec4(min(col, vec3(1.0)), 1.0);
}`
    const vs = compile(gl, gl.VERTEX_SHADER, vert)
    const fs = compile(gl, gl.FRAGMENT_SHADER, frag)
    const prog = requireGlObject(gl.createProgram(), 'SinebobsGenerator: createProgram failed')
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog) ?? 'link failed'
      gl.deleteProgram(prog)
      throw new Error(`SinebobsGenerator: ${log}`)
    }
    const quad = requireGlObject(gl.createBuffer(), 'SinebobsGenerator: quad init failed')
    const vaoObj = requireGlObject(gl.createVertexArray(), 'SinebobsGenerator: quad init failed')
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
    uPhaseSpread = gl.getUniformLocation(prog, 'u_phaseSpread')
    uSprite = gl.getUniformLocation(prog, 'u_sprite')
    uPaletteCount = gl.getUniformLocation(prog, 'u_paletteCount')
    uPalette0 = gl.getUniformLocation(prog, 'u_palette[0]')
  }

  /** Previous frame for `trail`; the pool hands out cleared buffers, so we keep our own copy. */
  let prev: Uint8ClampedArray | null = null

  return {
    type: 'generator',
    id: 'sinebobs',
    renderers: ['cpu'],
    config: config,
    init() { prev = null },
    render(ctx: NodeContext, out: FrameBuffer, signal: Signal): void {
      const radius = scaleThickness(
        Math.max(2, resolveAnimatableFloat(radiusRef, signal)),
        out.width,
        out.height,
      )
      const rDraw = Math.max(1, radius)
      const freqX = resolveAnimatableFloat(freqXRef, signal)
      const freqY = resolveAnimatableFloat(freqYRef, signal)
      const amplitude = Math.max(0, Math.min(0.48, resolveAnimatableFloat(amplitudeRef, signal)))
      const trail = Math.max(0, Math.min(1, resolveAnimatableFloat(trailRef, signal)))
      if (ctx.gl && out.fbo && program && vao) {
        const gl = ctx.gl
        gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo)
        gl.viewport(0, 0, out.width, out.height)
        gl.useProgram(program)
        gl.bindVertexArray(vao)
        gl.uniform2f(uResolution, out.width, out.height)
        gl.uniform1f(uTime, signal.t)
        gl.uniform1f(uCount, count)
        gl.uniform1f(uRadius, rDraw)
        gl.uniform2f(uFreq, freqX, freqY)
        gl.uniform1f(uAmplitude, amplitude)
        gl.uniform1f(uPhaseSpread, phaseSpread)
        gl.uniform1f(uSprite, spriteIndex(sprite))
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
      if (prev?.length !== data.length) prev = new Uint8ClampedArray(data.length)
      data.set(prev)
      const keep = trail ** frameSteps(signal)
      const fade = 1 - keep * 0.92
      for (let i = 0; i < data.length; i += 4) {
        data[i] = Math.round((data[i] ?? 0) * keep)
        data[i + 1] = Math.round((data[i + 1] ?? 0) * keep)
        data[i + 2] = Math.round((data[i + 2] ?? 0) * keep)
        data[i + 3] = Math.round(Math.max((data[i + 3] ?? 0) * keep, 255 * fade))
      }
      const rx = w * amplitude
      const ry = h * amplitude * 0.72
      for (let i = 0; i < count; i++) {
        const phase = i * phaseSpread
        const x = w * 0.5 + Math.sin(signal.t * freqX + phase) * rx
        const y = h * 0.5 + Math.sin(signal.t * freqY + phase * 1.37) * ry
        drawBob(data, w, h, x, y, rDraw, samplePalette(palette, i / Math.max(1, count - 1)), sprite)
      }
      prev.set(data)
    },
    destroy() {
      prev = null
      program = null
      vao = null
      uResolution = null
      uTime = null
      uCount = null
      uRadius = null
      uFreq = null
      uAmplitude = null
      uPhaseSpread = null
      uSprite = null
      uPaletteCount = null
      uPalette0 = null
    },
  }
}

function drawBob(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  cx: number,
  cy: number,
  radius: number,
  color: [number, number, number],
  sprite: NonNullable<SinebobsConfig['sprite']>,
): void {
  const r = Math.max(1, Math.round(radius))
  for (let yy = -r; yy <= r; yy++) {
    for (let xx = -r; xx <= r; xx++) {
      const x = Math.round(cx + xx)
      const y = Math.round(cy + yy)
      if (x < 0 || y < 0 || x >= w || y >= h) continue
      const nx = xx / Math.max(1, r)
      const ny = yy / Math.max(1, r)
      const intensity = shapeValue(nx, ny, sprite)
      if (intensity <= 0) continue
      const o = (y * w + x) * 4
      data[o] = Math.min(255, Math.round((data[o] ?? 0) + color[0] * intensity))
      data[o + 1] = Math.min(255, Math.round((data[o + 1] ?? 0) + color[1] * intensity))
      data[o + 2] = Math.min(255, Math.round((data[o + 2] ?? 0) + color[2] * intensity))
      data[o + 3] = 255
    }
  }
}

function shapeValue(x: number, y: number, sprite: NonNullable<SinebobsConfig['sprite']>): number {
  if (sprite === 'diamond') return Math.max(0, 1 - (Math.abs(x) + Math.abs(y)))
  if (sprite === 'star') {
    const a = Math.atan2(y, x)
    const rr = Math.sqrt(x * x + y * y)
    return Math.max(0, 0.78 + 0.22 * Math.cos(a * 5) - rr)
  }
  return Math.max(0, 1 - Math.sqrt(x * x + y * y))
}

function spriteIndex(sprite: NonNullable<SinebobsConfig['sprite']>): number {
  if (sprite === 'star') return 1
  if (sprite === 'diamond') return 2
  return 0
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
