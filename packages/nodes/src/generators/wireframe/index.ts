import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Generator,
  type NodeContext,
  type Signal,
} from '@overscan/types'
import { scaleFovMultiplier, scaleThickness } from '../../viewport-scale.js'

export interface WireframeConfig {
  color?: string
  backgroundColor?: string
  lineWidth?: AnimatableFloat
  scale?: AnimatableFloat
  rotationX?: AnimatableFloat
  rotationY?: AnimatableFloat
  rotationZ?: AnimatableFloat
  fov?: AnimatableFloat
  cameraZ?: AnimatableFloat
}

type Vec3 = [number, number, number]
type Vec2 = [number, number]

const VERTICES: Vec3[] = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
]
const EDGES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
]

export function WireframeGenerator(config: Partial<WireframeConfig> = {}): Generator {
  const color = hexToRgb(config.color ?? '#88f8ff')
  const background = hexToRgb(config.backgroundColor ?? '#04070f')
  const lineWidthRef = config.lineWidth ?? 2
  const scaleRef = config.scale ?? 1
  const rotationXRef = config.rotationX ?? 0.7
  const rotationYRef = config.rotationY ?? 1.1
  const rotationZRef = config.rotationZ ?? 0.4
  const fovRef = config.fov ?? 230
  const cameraZRef = config.cameraZ ?? 4.5
  let program: WebGLProgram | null = null
  let vao: WebGLVertexArrayObject | null = null
  let uResolution: WebGLUniformLocation | null = null
  let uEdgesA: WebGLUniformLocation | null = null
  let uEdgesB: WebGLUniformLocation | null = null
  let uColor: WebGLUniformLocation | null = null
  let uBackground: WebGLUniformLocation | null = null
  let uLineWidth: WebGLUniformLocation | null = null

  function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type)
    if (!shader) throw new Error('WireframeGenerator: createShader failed')
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? 'compile failed'
      gl.deleteShader(shader)
      throw new Error(`WireframeGenerator: ${log}`)
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
uniform vec2 u_edgesA[12];
uniform vec2 u_edgesB[12];
uniform vec3 u_color;
uniform vec3 u_background;
uniform float u_lineWidth;
out vec4 fragColor;
float segmentDistance(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.0001), 0.0, 1.0);
  return length(pa - ba * h);
}
void main() {
  vec2 p = gl_FragCoord.xy;
  float line = 0.0;
  for (int i = 0; i < 12; i++) {
    float d = segmentDistance(p, u_edgesA[i], u_edgesB[i]);
    line = max(line, smoothstep(u_lineWidth + 1.2, max(0.2, u_lineWidth - 0.2), d));
  }
  vec3 col = mix(u_background, u_color, line);
  fragColor = vec4(col, 1.0);
}`
    const vs = compile(gl, gl.VERTEX_SHADER, vert)
    const fs = compile(gl, gl.FRAGMENT_SHADER, frag)
    const prog = gl.createProgram()
    if (!prog) throw new Error('WireframeGenerator: createProgram failed')
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog)
    gl.deleteShader(vs); gl.deleteShader(fs)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog) ?? 'link failed'
      gl.deleteProgram(prog)
      throw new Error(`WireframeGenerator: ${log}`)
    }
    const quad = gl.createBuffer()
    const vaoObj = gl.createVertexArray()
    if (!quad || !vaoObj) throw new Error('WireframeGenerator: quad init failed')
    gl.bindVertexArray(vaoObj)
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(prog, 'a_pos')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
    program = prog
    vao = vaoObj
    uResolution = gl.getUniformLocation(prog, 'u_resolution')
    uEdgesA = gl.getUniformLocation(prog, 'u_edgesA[0]')
    uEdgesB = gl.getUniformLocation(prog, 'u_edgesB[0]')
    uColor = gl.getUniformLocation(prog, 'u_color')
    uBackground = gl.getUniformLocation(prog, 'u_background')
    uLineWidth = gl.getUniformLocation(prog, 'u_lineWidth')
  }

  return {
    type: 'generator',
    id: 'wireframe',
    renderers: ['gpu', 'cpu'],
    config: config,
    init(ctx) { ensureGpu(ctx) },
    render(ctx: NodeContext, out: FrameBuffer, signal: Signal): void {
      const lineWidth = scaleThickness(
        Math.max(1, resolveAnimatableFloat(lineWidthRef, signal)),
        out.width,
        out.height,
      )
      const fov = scaleFovMultiplier(
        Math.max(40, resolveAnimatableFloat(fovRef, signal)),
        out.width,
        out.height,
      )
      const points = projectCube(
        out.width,
        out.height,
        resolveAnimatableFloat(scaleRef, signal),
        resolveAnimatableFloat(rotationXRef, signal) * signal.t,
        resolveAnimatableFloat(rotationYRef, signal) * signal.t,
        resolveAnimatableFloat(rotationZRef, signal) * signal.t,
        fov,
        Math.max(2.5, resolveAnimatableFloat(cameraZRef, signal)),
      )
      if (ctx.gl && out.fbo && program && vao) {
        const gl = ctx.gl
        gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo)
        gl.viewport(0, 0, out.width, out.height)
        gl.useProgram(program)
        gl.bindVertexArray(vao)
        gl.uniform2f(uResolution, out.width, out.height)
        gl.uniform3f(uColor, color[0] / 255, color[1] / 255, color[2] / 255)
        gl.uniform3f(uBackground, background[0] / 255, background[1] / 255, background[2] / 255)
        gl.uniform1f(uLineWidth, lineWidth)
        const aData = new Float32Array(24)
        const bData = new Float32Array(24)
        for (let i = 0; i < EDGES.length; i++) {
          const [a, b] = EDGES[i]!
          const pa = points[a]!
          const pb = points[b]!
          aData[i * 2] = pa[0]; aData[i * 2 + 1] = pa[1]
          bData[i * 2] = pb[0]; bData[i * 2 + 1] = pb[1]
        }
        if (uEdgesA) gl.uniform2fv(uEdgesA, aData)
        if (uEdgesB) gl.uniform2fv(uEdgesB, bData)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        return
      }
      const data = out.data
      fillBuffer(data, background)
      for (const [a, b] of EDGES) {
        drawLine(data, out.width, out.height, points[a]!, points[b]!, lineWidth, color)
      }
    },
    destroy() {
      program = null; vao = null; uResolution = null; uEdgesA = null; uEdgesB = null; uColor = null; uBackground = null; uLineWidth = null
    },
  }
}

function projectCube(w: number, h: number, scale: number, rx: number, ry: number, rz: number, fov: number, cameraZ: number): Vec2[] {
  return VERTICES.map((v) => {
    const p = rotate3([v[0] * scale, v[1] * scale, v[2] * scale], rx, ry, rz)
    const z = p[2] + cameraZ
    return [w * 0.5 + (p[0] / z) * fov, h * 0.5 + (p[1] / z) * fov]
  })
}

function rotate3([x0, y0, z0]: Vec3, ax: number, ay: number, az: number): Vec3 {
  let x = x0, y = y0, z = z0
  let c = Math.cos(ax), s = Math.sin(ax)
  ;[y, z] = [y * c - z * s, y * s + z * c]
  c = Math.cos(ay); s = Math.sin(ay)
  ;[x, z] = [x * c + z * s, -x * s + z * c]
  c = Math.cos(az); s = Math.sin(az)
  ;[x, y] = [x * c - y * s, x * s + y * c]
  return [x, y, z]
}

function fillBuffer(data: Uint8ClampedArray, color: [number, number, number]): void {
  for (let i = 0; i < data.length; i += 4) {
    data[i] = color[0]; data[i + 1] = color[1]; data[i + 2] = color[2]; data[i + 3] = 255
  }
}

function drawLine(data: Uint8ClampedArray, w: number, h: number, a: Vec2, b: Vec2, width: number, color: [number, number, number]): void {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))))
  const r = Math.max(1, Math.round(width))
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const x = a[0] + (b[0] - a[0]) * t
    const y = a[1] + (b[1] - a[1]) * t
    for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) {
      const xi = Math.round(x + xx), yi = Math.round(y + yy)
      if (xi < 0 || yi < 0 || xi >= w || yi >= h) continue
      const d = Math.sqrt(xx * xx + yy * yy)
      if (d > r) continue
      const o = (yi * w + xi) * 4
      const alpha = 1 - d / Math.max(1, r)
      data[o] = Math.min(255, Math.round((data[o] ?? 0) + color[0] * alpha))
      data[o + 1] = Math.min(255, Math.round((data[o + 1] ?? 0) + color[1] * alpha))
      data[o + 2] = Math.min(255, Math.round((data[o + 2] ?? 0) + color[2] * alpha))
      data[o + 3] = 255
    }
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const s = hex.replace('#', '')
  const n = parseInt(s.length === 3 ? s.split('').map(c => c + c).join('') : s, 16)
  return [Number.isFinite(n) ? (n >> 16) & 0xff : 255, Number.isFinite(n) ? (n >> 8) & 0xff : 255, Number.isFinite(n) ? n & 0xff : 255]
}
