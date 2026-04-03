import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Generator,
  type NodeContext,
  type Signal,
} from '@overscan/types'

export interface MetaballsConfig {
  count?: number
  threshold?: AnimatableFloat
  speed?: AnimatableFloat
  palette?: number[][]
  freqX?: AnimatableFloat
  freqY?: AnimatableFloat
  glow?: AnimatableFloat
}

const DEFAULT_PALETTE = [
  [8, 4, 24],
  [76, 14, 112],
  [255, 50, 170],
  [255, 210, 96],
  [255, 255, 255],
]

interface Ball {
  phaseX: number
  phaseY: number
  radius: number
}

export function MetaballsGenerator(config: Partial<MetaballsConfig> = {}): Generator {
  const count = Math.max(1, Math.min(12, Math.round(config.count ?? 5)))
  const thresholdRef = config.threshold ?? 0.5
  const speedRef = config.speed ?? 1
  const freqXRef = config.freqX ?? 1
  const freqYRef = config.freqY ?? 0.7
  const glowRef = config.glow ?? 0
  const palette = config.palette ?? DEFAULT_PALETTE
  const balls: Ball[] = Array.from({ length: count }, (_, i) => ({
    phaseX: i * 1.31,
    phaseY: i * 1.97,
    radius: 0.12 + (i % 3) * 0.03,
  }))
  let program: WebGLProgram | null = null
  let vao: WebGLVertexArrayObject | null = null
  let uResolution: WebGLUniformLocation | null = null
  let uTime: WebGLUniformLocation | null = null
  let uCount: WebGLUniformLocation | null = null
  let uThreshold: WebGLUniformLocation | null = null
  let uFreq: WebGLUniformLocation | null = null
  let uGlow: WebGLUniformLocation | null = null
  let uPaletteCount: WebGLUniformLocation | null = null
  let uPalette0: WebGLUniformLocation | null = null

  function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type)
    if (!shader) throw new Error('MetaballsGenerator: createShader failed')
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? 'compile failed'
      gl.deleteShader(shader)
      throw new Error(`MetaballsGenerator: ${log}`)
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
uniform float u_threshold;
uniform vec2 u_freq;
uniform float u_glow;
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
  float count = max(1.0, u_count);
  for (float i = 0.0; i < 16.0; i += 1.0) {
    if (i >= count) break;
    vec2 pos = vec2(
      0.5 + sin(u_time * u_freq.x + i * 1.31) * 0.28,
      0.5 + sin(u_time * u_freq.y + i * 1.97) * 0.24
    );
    float radius = 0.12 + mod(i, 3.0) * 0.03;
    vec2 d = uv - pos;
    field += (radius * radius) / max(dot(d, d), 0.0008);
  }
  float edge = smoothstep(u_threshold - 0.15 - u_glow * 0.3, u_threshold + 0.25, field);
  vec3 col = paletteSample(edge) * edge;
  fragColor = vec4(col, edge);
}`
    const vs = compile(gl, gl.VERTEX_SHADER, vert)
    const fs = compile(gl, gl.FRAGMENT_SHADER, frag)
    const prog = gl.createProgram()
    if (!prog) throw new Error('MetaballsGenerator: createProgram failed')
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog) ?? 'link failed'
      gl.deleteProgram(prog)
      throw new Error(`MetaballsGenerator: ${log}`)
    }
    const quad = gl.createBuffer()
    const vaoObj = gl.createVertexArray()
    if (!quad || !vaoObj) throw new Error('MetaballsGenerator: quad init failed')
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
    uThreshold = gl.getUniformLocation(prog, 'u_threshold')
    uFreq = gl.getUniformLocation(prog, 'u_freq')
    uGlow = gl.getUniformLocation(prog, 'u_glow')
    uPaletteCount = gl.getUniformLocation(prog, 'u_paletteCount')
    uPalette0 = gl.getUniformLocation(prog, 'u_palette[0]')
  }

  return {
    type: 'generator',
    id: 'metaballs',
    renderers: ['gpu', 'cpu'],
    config: config as Generator['config'],
    init(ctx) { ensureGpu(ctx) },
    render(ctx: NodeContext, out: FrameBuffer, signal: Signal): void {
      const speed = resolveAnimatableFloat(speedRef, signal)
      const threshold = Math.max(0.05, resolveAnimatableFloat(thresholdRef, signal))
      const freqX = resolveAnimatableFloat(freqXRef, signal)
      const freqY = resolveAnimatableFloat(freqYRef, signal)
      const glow = Math.max(0, Math.min(1, resolveAnimatableFloat(glowRef, signal)))
      const time = signal.t * speed
      if (ctx.gl && out.fbo && program && vao) {
        const gl = ctx.gl
        gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo)
        gl.viewport(0, 0, out.width, out.height)
        gl.useProgram(program)
        gl.bindVertexArray(vao)
        gl.uniform2f(uResolution, out.width, out.height)
        gl.uniform1f(uTime, time)
        gl.uniform1f(uCount, count)
        gl.uniform1f(uThreshold, threshold * 8)
        gl.uniform2f(uFreq, freqX, freqY)
        gl.uniform1f(uGlow, glow)
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
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const uvx = x / Math.max(1, w - 1)
          const uvy = y / Math.max(1, h - 1)
          let field = 0
          for (let i = 0; i < balls.length; i++) {
            const ball = balls[i]!
            const bx = 0.5 + Math.sin(time * freqX + ball.phaseX) * 0.28
            const by = 0.5 + Math.sin(time * freqY + ball.phaseY) * 0.24
            const dx = uvx - bx
            const dy = uvy - by
            field += (ball.radius * ball.radius) / Math.max(dx * dx + dy * dy, 0.0008)
          }
          const edge = smoothstep(threshold * 8 - 0.15 - glow * 0.3, threshold * 8 + 0.25, field)
          const c = samplePalette(palette, edge)
          const o = (y * w + x) * 4
          data[o] = Math.round(c[0] * edge)
          data[o + 1] = Math.round(c[1] * edge)
          data[o + 2] = Math.round(c[2] * edge)
          data[o + 3] = Math.round(edge * 255)
        }
      }
    },
    destroy() {
      program = null
      vao = null
      uResolution = null
      uTime = null
      uCount = null
      uThreshold = null
      uFreq = null
      uGlow = null
      uPaletteCount = null
      uPalette0 = null
    },
  }
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / Math.max(0.0001, b - a)))
  return t * t * (3 - 2 * t)
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
