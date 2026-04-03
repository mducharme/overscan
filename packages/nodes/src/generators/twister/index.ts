import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Generator,
  type NodeContext,
  type Signal,
} from '@overscan/types'

export interface TwisterConfig {
  palette?: number[][]
  backgroundColor?: string
  twistSpeed?: AnimatableFloat
  verticalFrequency?: AnimatableFloat
  width?: AnimatableFloat
  sway?: AnimatableFloat
  centerX?: AnimatableFloat
  shading?: AnimatableFloat
}

const DEFAULT_PALETTE = [
  [255, 72, 154],
  [255, 203, 76],
  [92, 246, 164],
  [86, 168, 255],
]

export function TwisterGenerator(config: Partial<TwisterConfig> = {}): Generator {
  const palette = (config.palette?.length ? config.palette : DEFAULT_PALETTE).slice(0, 4)
  const background = hexToRgb(config.backgroundColor ?? '#050812')
  const twistSpeedRef = config.twistSpeed ?? 1.6
  const verticalFrequencyRef = config.verticalFrequency ?? 1.35
  const widthRef = config.width ?? 0.24
  const swayRef = config.sway ?? 0.16
  const centerXRef = config.centerX ?? 0.5
  const shadingRef = config.shading ?? 0.7
  let program: WebGLProgram | null = null
  let vao: WebGLVertexArrayObject | null = null
  let uResolution: WebGLUniformLocation | null = null
  let uTime: WebGLUniformLocation | null = null
  let uPalette0: WebGLUniformLocation | null = null
  let uBackground: WebGLUniformLocation | null = null
  let uWidth: WebGLUniformLocation | null = null
  let uSway: WebGLUniformLocation | null = null
  let uCenterX: WebGLUniformLocation | null = null
  let uTwistSpeed: WebGLUniformLocation | null = null
  let uVerticalFrequency: WebGLUniformLocation | null = null
  let uShading: WebGLUniformLocation | null = null

  function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type)
    if (!shader) throw new Error('TwisterGenerator: createShader failed')
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? 'compile failed'
      gl.deleteShader(shader)
      throw new Error(`TwisterGenerator: ${log}`)
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
uniform vec3 u_palette[4];
uniform vec3 u_background;
uniform float u_width;
uniform float u_sway;
uniform float u_centerX;
uniform float u_twistSpeed;
uniform float u_verticalFrequency;
uniform float u_shading;
out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float phase = uv.y * 6.28318530718 * max(0.05, u_verticalFrequency) + u_time * max(0.05, u_twistSpeed);
  float center = u_centerX + sin(uv.y * 5.2 + u_time * 0.85) * u_sway;
  float halfWidth = max(0.002, u_width * (0.18 + 0.82 * abs(cos(phase))));
  float local = (uv.x - center) / halfWidth;
  vec3 col = u_background;
  if (abs(local) <= 1.0) {
    float theta = asin(clamp(local, -1.0, 1.0));
    float stripePhase = phase + theta * 2.2;
    float stripeIndex = floor(mod(stripePhase / 1.57079632679 + 8.0, 4.0));
    vec3 base = u_palette[int(stripeIndex)];
    float cylindrical = sqrt(max(0.0, 1.0 - local * local));
    float shade = mix(0.28, 1.0, cylindrical) * mix(1.0, 0.45 + cylindrical * 0.55, clamp(u_shading, 0.0, 1.0));
    float edgeGlow = pow(cylindrical, 0.35);
    col = min(vec3(1.0), base * shade + base * edgeGlow * 0.16);
  }
  fragColor = vec4(col, 1.0);
}`
    const vs = compile(gl, gl.VERTEX_SHADER, vert)
    const fs = compile(gl, gl.FRAGMENT_SHADER, frag)
    const prog = gl.createProgram()
    if (!prog) throw new Error('TwisterGenerator: createProgram failed')
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog) ?? 'link failed'
      gl.deleteProgram(prog)
      throw new Error(`TwisterGenerator: ${log}`)
    }
    const quad = gl.createBuffer()
    const vaoObj = gl.createVertexArray()
    if (!quad || !vaoObj) throw new Error('TwisterGenerator: quad init failed')
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
    uPalette0 = gl.getUniformLocation(prog, 'u_palette[0]')
    uBackground = gl.getUniformLocation(prog, 'u_background')
    uWidth = gl.getUniformLocation(prog, 'u_width')
    uSway = gl.getUniformLocation(prog, 'u_sway')
    uCenterX = gl.getUniformLocation(prog, 'u_centerX')
    uTwistSpeed = gl.getUniformLocation(prog, 'u_twistSpeed')
    uVerticalFrequency = gl.getUniformLocation(prog, 'u_verticalFrequency')
    uShading = gl.getUniformLocation(prog, 'u_shading')
  }

  return {
    type: 'generator',
    id: 'twister',
    renderers: ['gpu', 'cpu'],
    config: config as Generator['config'],
    init(ctx) { ensureGpu(ctx) },
    render(ctx: NodeContext, out: FrameBuffer, signal: Signal): void {
      const twistSpeed = resolveAnimatableFloat(twistSpeedRef, signal)
      const verticalFrequency = Math.max(0.05, resolveAnimatableFloat(verticalFrequencyRef, signal))
      const width = Math.max(0.04, Math.min(0.45, resolveAnimatableFloat(widthRef, signal)))
      const sway = Math.max(0, Math.min(0.35, resolveAnimatableFloat(swayRef, signal)))
      const centerX = Math.max(0.1, Math.min(0.9, resolveAnimatableFloat(centerXRef, signal)))
      const shading = Math.max(0, Math.min(1, resolveAnimatableFloat(shadingRef, signal)))
      if (ctx.gl && out.fbo && program && vao) {
        const gl = ctx.gl
        gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo)
        gl.viewport(0, 0, out.width, out.height)
        gl.useProgram(program)
        gl.bindVertexArray(vao)
        gl.uniform2f(uResolution, out.width, out.height)
        gl.uniform1f(uTime, signal.t)
        gl.uniform1f(uWidth, width)
        gl.uniform1f(uSway, sway)
        gl.uniform1f(uCenterX, centerX)
        gl.uniform1f(uTwistSpeed, twistSpeed)
        gl.uniform1f(uVerticalFrequency, verticalFrequency)
        gl.uniform1f(uShading, shading)
        gl.uniform3f(uBackground, background[0] / 255, background[1] / 255, background[2] / 255)
        const flat = new Float32Array(12)
        for (let i = 0; i < 4; i++) {
          const c = palette[i % palette.length] ?? DEFAULT_PALETTE[i]!
          flat[i * 3] = (c[0] ?? 0) / 255
          flat[i * 3 + 1] = (c[1] ?? 0) / 255
          flat[i * 3 + 2] = (c[2] ?? 0) / 255
        }
        if (uPalette0) gl.uniform3fv(uPalette0, flat)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        return
      }
      renderCpu(out, signal.t, palette, background, twistSpeed, verticalFrequency, width, sway, centerX, shading)
    },
    destroy() {
      program = null
      vao = null
      uResolution = null
      uTime = null
      uPalette0 = null
      uBackground = null
      uWidth = null
      uSway = null
      uCenterX = null
      uTwistSpeed = null
      uVerticalFrequency = null
      uShading = null
    },
  }
}

function renderCpu(
  out: FrameBuffer,
  time: number,
  palette: number[][],
  background: [number, number, number],
  twistSpeed: number,
  verticalFrequency: number,
  width: number,
  sway: number,
  centerX: number,
  shading: number,
): void {
  const { width: w, height: h, data } = out
  for (let y = 0; y < h; y++) {
    const v = y / Math.max(1, h - 1)
    const phase = v * Math.PI * 2 * verticalFrequency + time * twistSpeed
    const center = centerX + Math.sin(v * 5.2 + time * 0.85) * sway
    const halfWidth = Math.max(1, width * w * (0.18 + 0.82 * Math.abs(Math.cos(phase))))
    const cx = center * w
    const left = Math.max(0, Math.floor(cx - halfWidth - 1))
    const right = Math.min(w - 1, Math.ceil(cx + halfWidth + 1))
    fillRow(data, w, y, background)
    for (let x = left; x <= right; x++) {
      const local = (x - cx) / halfWidth
      if (Math.abs(local) > 1) continue
      const theta = Math.asin(Math.max(-1, Math.min(1, local)))
      const stripePhase = phase + theta * 2.2
      const stripeIndex = ((Math.floor(stripePhase / (Math.PI * 0.5)) % 4) + 4) % 4
      const base = palette[stripeIndex] ?? DEFAULT_PALETTE[stripeIndex]!
      const cylindrical = Math.sqrt(Math.max(0, 1 - local * local))
      const shade = mix(0.28, 1, cylindrical) * mix(1, 0.45 + cylindrical * 0.55, shading)
      const glow = Math.pow(cylindrical, 0.35) * 0.16
      const o = (y * w + x) * 4
      data[o] = clamp255((base[0] ?? 0) * shade + (base[0] ?? 0) * glow)
      data[o + 1] = clamp255((base[1] ?? 0) * shade + (base[1] ?? 0) * glow)
      data[o + 2] = clamp255((base[2] ?? 0) * shade + (base[2] ?? 0) * glow)
      data[o + 3] = 255
    }
  }
}

function fillRow(data: Uint8ClampedArray, w: number, y: number, color: [number, number, number]): void {
  const row = y * w * 4
  for (let x = 0; x < w; x++) {
    const o = row + x * 4
    data[o] = color[0]
    data[o + 1] = color[1]
    data[o + 2] = color[2]
    data[o + 3] = 255
  }
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function clamp255(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '')
  const expanded = normalized.length === 3 ? normalized.split('').map((c) => c + c).join('') : normalized
  const value = parseInt(expanded, 16)
  if (!Number.isFinite(value)) return [255, 255, 255]
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}
