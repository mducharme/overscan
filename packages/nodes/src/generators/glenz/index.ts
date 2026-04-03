import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Generator,
  type NodeContext,
  type Signal,
} from '@overscan/types'
import { scaleFovMultiplier } from '../../viewport-scale.js'

type Vec2 = [number, number]
type Vec3 = [number, number, number]
type Tri = [number, number, number]

export interface GlenzConfig {
  palette?: number[][]
  backgroundColor?: string
  alpha?: AnimatableFloat
  scale?: AnimatableFloat
  rotationX?: AnimatableFloat
  rotationY?: AnimatableFloat
  rotationZ?: AnimatableFloat
  fov?: AnimatableFloat
  cameraZ?: AnimatableFloat
}

const PALETTE = [
  [255, 84, 164],
  [255, 208, 88],
  [72, 230, 196],
  [96, 154, 255],
  [190, 116, 255],
  [255, 255, 255],
]
const VERTICES: Vec3[] = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
]
const TRIANGLES: Tri[] = [
  [0, 1, 2], [0, 2, 3],
  [4, 5, 6], [4, 6, 7],
  [0, 1, 5], [0, 5, 4],
  [1, 2, 6], [1, 6, 5],
  [2, 3, 7], [2, 7, 6],
  [3, 0, 4], [3, 4, 7],
]

export function GlenzGenerator(config: Partial<GlenzConfig> = {}): Generator {
  const palette = config.palette ?? PALETTE
  const background = hexToRgb(config.backgroundColor ?? '#04060e')
  const alphaRef = config.alpha ?? 0.34
  const scaleRef = config.scale ?? 1
  const rotationXRef = config.rotationX ?? 0.55
  const rotationYRef = config.rotationY ?? 0.95
  const rotationZRef = config.rotationZ ?? 0.35
  const fovRef = config.fov ?? 220
  const cameraZRef = config.cameraZ ?? 4.4
  let program: WebGLProgram | null = null
  let vao: WebGLVertexArrayObject | null = null
  let uResolution: WebGLUniformLocation | null = null
  let uTriA: WebGLUniformLocation | null = null
  let uTriB: WebGLUniformLocation | null = null
  let uTriC: WebGLUniformLocation | null = null
  let uTriColor: WebGLUniformLocation | null = null
  let uBackground: WebGLUniformLocation | null = null
  let uAlpha: WebGLUniformLocation | null = null

  function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type)
    if (!shader) throw new Error('GlenzGenerator: createShader failed')
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? 'compile failed'
      gl.deleteShader(shader)
      throw new Error(`GlenzGenerator: ${log}`)
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
uniform vec2 u_triA[12];
uniform vec2 u_triB[12];
uniform vec2 u_triC[12];
uniform vec4 u_triColor[12];
uniform vec3 u_background;
uniform float u_alpha;
out vec4 fragColor;
float edge(vec2 a, vec2 b, vec2 p) {
  return (p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x);
}
void main() {
  vec2 p = gl_FragCoord.xy;
  vec3 col = u_background;
  for (int i = 0; i < 12; i++) {
    vec2 a = u_triA[i], b = u_triB[i], c = u_triC[i];
    float area = edge(a, b, c);
    float w0 = edge(b, c, p);
    float w1 = edge(c, a, p);
    float w2 = edge(a, b, p);
    bool inside = area >= 0.0 ? (w0 >= 0.0 && w1 >= 0.0 && w2 >= 0.0) : (w0 <= 0.0 && w1 <= 0.0 && w2 <= 0.0);
    if (!inside) continue;
    vec3 tri = u_triColor[i].rgb;
    col = mix(col, min(vec3(1.0), col + tri * 0.55), u_triColor[i].a * u_alpha);
  }
  fragColor = vec4(col, 1.0);
}`
    const vs = compile(gl, gl.VERTEX_SHADER, vert)
    const fs = compile(gl, gl.FRAGMENT_SHADER, frag)
    const prog = gl.createProgram()
    if (!prog) throw new Error('GlenzGenerator: createProgram failed')
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog)
    gl.deleteShader(vs); gl.deleteShader(fs)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog) ?? 'link failed'
      gl.deleteProgram(prog)
      throw new Error(`GlenzGenerator: ${log}`)
    }
    const quad = gl.createBuffer()
    const vaoObj = gl.createVertexArray()
    if (!quad || !vaoObj) throw new Error('GlenzGenerator: quad init failed')
    gl.bindVertexArray(vaoObj)
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(prog, 'a_pos')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
    program = prog
    vao = vaoObj
    uResolution = gl.getUniformLocation(prog, 'u_resolution')
    uTriA = gl.getUniformLocation(prog, 'u_triA[0]')
    uTriB = gl.getUniformLocation(prog, 'u_triB[0]')
    uTriC = gl.getUniformLocation(prog, 'u_triC[0]')
    uTriColor = gl.getUniformLocation(prog, 'u_triColor[0]')
    uBackground = gl.getUniformLocation(prog, 'u_background')
    uAlpha = gl.getUniformLocation(prog, 'u_alpha')
  }

  return {
    type: 'generator',
    id: 'glenz',
    renderers: ['gpu', 'cpu'],
    config: config as Generator['config'],
    init(ctx) { ensureGpu(ctx) },
    render(ctx: NodeContext, out: FrameBuffer, signal: Signal): void {
      const alpha = Math.max(0.05, Math.min(1, resolveAnimatableFloat(alphaRef, signal)))
      const fov = scaleFovMultiplier(
        Math.max(40, resolveAnimatableFloat(fovRef, signal)),
        out.width,
        out.height,
      )
      const projected = projectObject(
        out.width,
        out.height,
        resolveAnimatableFloat(scaleRef, signal),
        resolveAnimatableFloat(rotationXRef, signal) * signal.t,
        resolveAnimatableFloat(rotationYRef, signal) * signal.t,
        resolveAnimatableFloat(rotationZRef, signal) * signal.t,
        fov,
        Math.max(2.5, resolveAnimatableFloat(cameraZRef, signal)),
        palette,
      )
      if (ctx.gl && out.fbo && program && vao) {
        const gl = ctx.gl
        gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo)
        gl.viewport(0, 0, out.width, out.height)
        gl.useProgram(program)
        gl.bindVertexArray(vao)
        gl.uniform2f(uResolution, out.width, out.height)
        gl.uniform3f(uBackground, background[0] / 255, background[1] / 255, background[2] / 255)
        gl.uniform1f(uAlpha, alpha)
        const aData = new Float32Array(24)
        const bData = new Float32Array(24)
        const cData = new Float32Array(24)
        const colorData = new Float32Array(48)
        for (let i = 0; i < projected.length; i++) {
          const tri = projected[i]!
          aData[i * 2] = tri.a[0]; aData[i * 2 + 1] = tri.a[1]
          bData[i * 2] = tri.b[0]; bData[i * 2 + 1] = tri.b[1]
          cData[i * 2] = tri.c[0]; cData[i * 2 + 1] = tri.c[1]
          colorData[i * 4] = tri.color[0] / 255
          colorData[i * 4 + 1] = tri.color[1] / 255
          colorData[i * 4 + 2] = tri.color[2] / 255
          colorData[i * 4 + 3] = tri.opacity
        }
        if (uTriA) gl.uniform2fv(uTriA, aData)
        if (uTriB) gl.uniform2fv(uTriB, bData)
        if (uTriC) gl.uniform2fv(uTriC, cData)
        if (uTriColor) gl.uniform4fv(uTriColor, colorData)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        return
      }

      const data = out.data
      fillBuffer(data, background)
      for (const tri of projected) drawTriangle(data, out.width, out.height, tri.a, tri.b, tri.c, tri.color, tri.opacity * alpha)
    },
    destroy() {
      program = null; vao = null; uResolution = null; uTriA = null; uTriB = null; uTriC = null; uTriColor = null; uBackground = null; uAlpha = null
    },
  }
}

function projectObject(w: number, h: number, scale: number, rx: number, ry: number, rz: number, fov: number, cameraZ: number, palette: number[][]) {
  const verts = VERTICES.map((v) => rotate3([v[0] * scale, v[1] * scale, v[2] * scale], rx, ry, rz))
  return TRIANGLES.map((tri, i) => {
    const a3 = verts[tri[0]]!, b3 = verts[tri[1]]!, c3 = verts[tri[2]]!
    const depth = (a3[2] + b3[2] + c3[2]) / 3
    const normal = normalOf(a3, b3, c3)
    const lit = Math.max(0.15, dot3(normalize3(normal), normalize3([0.5, 0.7, -1])))
    const color = tint(palette[i % palette.length] ?? PALETTE[i % PALETTE.length]!, 0.45 + lit * 0.75)
    return {
      a: projectPoint(a3, w, h, fov, cameraZ),
      b: projectPoint(b3, w, h, fov, cameraZ),
      c: projectPoint(c3, w, h, fov, cameraZ),
      color,
      opacity: 0.24 + lit * 0.22,
      depth,
    }
  }).sort((a, b) => a.depth - b.depth)
}

function projectPoint([x, y, z]: Vec3, w: number, h: number, fov: number, cameraZ: number): Vec2 {
  const zz = z + cameraZ
  return [w * 0.5 + (x / zz) * fov, h * 0.5 + (y / zz) * fov]
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

function drawTriangle(data: Uint8ClampedArray, w: number, h: number, a: Vec2, b: Vec2, c: Vec2, color: number[], alpha: number): void {
  const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])))
  const maxX = Math.min(w - 1, Math.ceil(Math.max(a[0], b[0], c[0])))
  const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])))
  const maxY = Math.min(h - 1, Math.ceil(Math.max(a[1], b[1], c[1])))
  const area = edge(a, b, c)
  if (Math.abs(area) < 1e-6) return
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const p: Vec2 = [x + 0.5, y + 0.5]
      const w0 = edge(b, c, p), w1 = edge(c, a, p), w2 = edge(a, b, p)
      const inside = area >= 0 ? (w0 >= 0 && w1 >= 0 && w2 >= 0) : (w0 <= 0 && w1 <= 0 && w2 <= 0)
      if (!inside) continue
      const o = (y * w + x) * 4
      data[o] = clamp255((data[o] ?? 0) * (1 - alpha) + (color[0] ?? 0) * alpha + (data[o] ?? 0) * alpha * 0.2)
      data[o + 1] = clamp255((data[o + 1] ?? 0) * (1 - alpha) + (color[1] ?? 0) * alpha + (data[o + 1] ?? 0) * alpha * 0.2)
      data[o + 2] = clamp255((data[o + 2] ?? 0) * (1 - alpha) + (color[2] ?? 0) * alpha + (data[o + 2] ?? 0) * alpha * 0.2)
      data[o + 3] = 255
    }
  }
}

function edge(a: Vec2, b: Vec2, p: Vec2): number {
  return (p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])
}

function fillBuffer(data: Uint8ClampedArray, color: [number, number, number]): void {
  for (let i = 0; i < data.length; i += 4) {
    data[i] = color[0]; data[i + 1] = color[1]; data[i + 2] = color[2]; data[i + 3] = 255
  }
}

function normalOf(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const ac: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  return [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]]
}

function dot3(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }
function normalize3(v: Vec3): Vec3 {
  const l = Math.max(1e-6, Math.sqrt(dot3(v, v)))
  return [v[0] / l, v[1] / l, v[2] / l]
}
function tint(color: number[], t: number): [number, number, number] {
  return [clamp255((color[0] ?? 0) * t), clamp255((color[1] ?? 0) * t), clamp255((color[2] ?? 0) * t)]
}
function clamp255(value: number): number { return Math.max(0, Math.min(255, Math.round(value))) }
function hexToRgb(hex: string): [number, number, number] {
  const s = hex.replace('#', '')
  const n = parseInt(s.length === 3 ? s.split('').map(c => c + c).join('') : s, 16)
  return [Number.isFinite(n) ? (n >> 16) & 0xff : 255, Number.isFinite(n) ? (n >> 8) & 0xff : 255, Number.isFinite(n) ? n & 0xff : 255]
}
