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
  /** Front faces alternate palette[0] and palette[1]; back faces use palette[2] and palette[3]. */
  palette?: number[][]
  backgroundColor?: string
  /** Opacity of the front faces. */
  alpha?: AnimatableFloat
  scale?: AnimatableFloat
  rotationX?: AnimatableFloat
  rotationY?: AnimatableFloat
  rotationZ?: AnimatableFloat
  fov?: AnimatableFloat
  cameraZ?: AnimatableFloat
  /** How far each face's pyramid tip sticks out (1 = flat cube). */
  spike?: number
}

const PALETTE = [
  [255, 255, 255],
  [72, 154, 255],
  [255, 84, 164],
  [96, 40, 180],
]

const CUBE: Vec3[] = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
]
/** Each cube face as its 4 corners in order, plus the axis its pyramid tip points along. */
const FACES: [number, number, number, number, Vec3][] = [
  [0, 1, 2, 3, [0, 0, -1]],
  [4, 5, 6, 7, [0, 0, 1]],
  [0, 1, 5, 4, [0, -1, 0]],
  [3, 2, 6, 7, [0, 1, 0]],
  [0, 3, 7, 4, [-1, 0, 0]],
  [1, 2, 6, 5, [1, 0, 0]],
]

/** Classic glenz object: a cube with a pyramid on each face (tetrakis hexahedron, 24 triangles). */
function glenzMesh(spike: number): { verts: Vec3[]; tris: Tri[] } {
  const verts = CUBE.slice()
  const tris: Tri[] = []
  for (const [a, b, c, d, axis] of FACES) {
    const tip = verts.push([axis[0] * spike, axis[1] * spike, axis[2] * spike]) - 1
    tris.push([a, b, tip], [b, c, tip], [c, d, tip], [d, a, tip])
  }
  return { verts, tris }
}

/**
 * Glenz vectors: a translucent faceted object. Triangles alternate two colours; faces pointing away
 * from the viewer are drawn first in a second, darker pair of colours, so they show through the
 * translucent front faces.
 */
export function GlenzGenerator(config: Partial<GlenzConfig> = {}): Generator {
  const palette = config.palette?.length ? config.palette : PALETTE
  const background = hexToRgb(config.backgroundColor ?? '#04060e')
  const alphaRef = config.alpha ?? 0.45
  const scaleRef = config.scale ?? 1
  const rotationXRef = config.rotationX ?? 0.55
  const rotationYRef = config.rotationY ?? 0.95
  const rotationZRef = config.rotationZ ?? 0.35
  const fovRef = config.fov ?? 220
  const cameraZRef = config.cameraZ ?? 4.4
  const spike = Math.max(1, config.spike ?? 1.45)

  return {
    type: 'generator',
    id: 'glenz',
    renderers: ['cpu'],
    config: config,
    init() {},
    render(_ctx: NodeContext, out: FrameBuffer, signal: Signal): void {
      const alpha = Math.max(0.05, Math.min(1, resolveAnimatableFloat(alphaRef, signal)))
      const fov = scaleFovMultiplier(Math.max(40, resolveAnimatableFloat(fovRef, signal)), out.width, out.height)
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
        spike,
      )
      const data = out.data
      fillBuffer(data, background)
      for (const tri of projected) {
        drawTriangle(data, out.width, out.height, tri.a, tri.b, tri.c, tri.color, tri.front ? alpha : Math.min(1, alpha * 1.5))
      }
    },
    destroy() {},
  }
}

/** Exported for tests. Returns triangles in draw order: far to near, so near faces blend over far ones. */
export function projectObject(
  w: number,
  h: number,
  scale: number,
  rx: number,
  ry: number,
  rz: number,
  fov: number,
  cameraZ: number,
  palette: number[][],
  spike = 1.45,
) {
  const mesh = glenzMesh(spike)
  const verts = mesh.verts.map(v => rotate3([v[0] * scale, v[1] * scale, v[2] * scale], rx, ry, rz))
  const light = normalize3([-0.5, -0.7, -1])
  return mesh.tris.map((tri, i) => {
    const a3 = verts[tri[0]]!, b3 = verts[tri[1]]!, c3 = verts[tri[2]]!
    const center: Vec3 = [(a3[0] + b3[0] + c3[0]) / 3, (a3[1] + b3[1] + c3[1]) / 3, (a3[2] + b3[2] + c3[2]) / 3]
    // Orient the normal outward (the object is convex and centred), then test it against the view ray.
    let normal = normalize3(normalOf(a3, b3, c3))
    if (dot3(normal, center) < 0) normal = [-normal[0], -normal[1], -normal[2]]
    const front = dot3(normal, [center[0], center[1], center[2] + cameraZ]) < 0
    const lit = Math.abs(dot3(normal, light))
    const base = palette[(front ? 0 : 2) + (i % 2)] ?? PALETTE[(front ? 0 : 2) + (i % 2)]!
    return {
      a: projectPoint(a3, w, h, fov, cameraZ),
      b: projectPoint(b3, w, h, fov, cameraZ),
      c: projectPoint(c3, w, h, fov, cameraZ),
      color: tint(base, front ? 0.55 + lit * 0.55 : 0.35 + lit * 0.35),
      front,
      depth: center[2],
    }
  }).sort((a, b) => b.depth - a.depth)
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
      data[o] = clamp255((data[o] ?? 0) * (1 - alpha) + (color[0] ?? 0) * alpha)
      data[o + 1] = clamp255((data[o + 1] ?? 0) * (1 - alpha) + (color[1] ?? 0) * alpha)
      data[o + 2] = clamp255((data[o + 2] ?? 0) * (1 - alpha) + (color[2] ?? 0) * alpha)
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
