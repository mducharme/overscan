import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Generator,
  type NodeContext,
  type Signal,
} from '@overscan/types'
import { scaleThickness, viewportMinDim } from '../../viewport-scale.js'

export type VectorBallsShape = 'cube' | 'octahedron' | 'sphere' | 'ring' | 'helix'

export interface VectorBallsConfig {
  /** Number of balls. */
  count?: number
  /** Ball radius in pixels at the 640×360 reference, for a ball at the object's center depth. */
  radius?: AnimatableFloat
  /** Rotation speed around the X axis. */
  freqX?: AnimatableFloat
  /** Rotation speed around the Y axis. */
  freqY?: AnimatableFloat
  /** Rotation speed around the Z axis. */
  freqZ?: AnimatableFloat
  /** Object size as a fraction of the frame's short side. */
  amplitude?: AnimatableFloat
  /** Shapes the balls morph through, in order (looping). */
  shapes?: VectorBallsShape[]
  /** Seconds spent on each shape, including the morph into the next. */
  morphPeriod?: number
  /** Accepted for compatibility; unused since balls sit on the object. */
  phaseSpread?: number
  /** Direction toward the light in screen axes (x right, y down, z into the screen). Default upper-left front. */
  lightDir?: [number, number, number]
  palette?: number[][]
  specular?: AnimatableFloat
}

type Vec3 = [number, number, number]

const DEFAULT_PALETTE = [
  [150, 158, 176],
  [176, 186, 202],
  [206, 214, 228],
]

const CUBE_VERTS: Vec3[] = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
]
const CUBE_EDGES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7],
]
const OCTA_VERTS: Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
const OCTA_EDGES: [number, number][] = [
  [0, 2], [0, 3], [0, 4], [0, 5], [1, 2], [1, 3], [1, 4], [1, 5], [2, 4], [4, 3], [3, 5], [5, 2],
]

/**
 * Classic vector balls: shaded balls placed on the vertices and edges of a rotating 3D object,
 * projected in perspective (nearer balls are larger) and drawn back to front. The object morphs
 * through `shapes`, each ball moving to its matching point on the next shape.
 */
export function VectorBallsGenerator(config: Partial<VectorBallsConfig> = {}): Generator {
  const count = Math.max(1, Math.min(96, Math.round(config.count ?? 20)))
  const radiusRef = config.radius ?? 18
  const freqXRef = config.freqX ?? 2
  const freqYRef = config.freqY ?? 3
  const freqZRef = config.freqZ ?? 1
  const ampRef = config.amplitude ?? 0.3
  const defaultShapes: VectorBallsShape[] = ['cube', 'sphere', 'ring']
  const shapes = (config.shapes?.length ? config.shapes : defaultShapes).map(s => makeShape(s, count))
  const morphPeriod = Math.max(0.5, config.morphPeriod ?? 4)
  const lightDir = normalize3(config.lightDir ?? [-1, -1, -1])
  const palette = config.palette?.length ? config.palette : DEFAULT_PALETTE
  const specularRef = config.specular ?? 0.8

  return {
    type: 'generator',
    id: 'vector-balls',
    renderers: ['cpu'],
    config: config,
    init() {},
    render(_ctx: NodeContext, out: FrameBuffer, signal: Signal): void {
      const { width: w, height: h, data } = out
      data.fill(0)
      const radius = Math.max(2, scaleThickness(Math.max(2, resolveAnimatableFloat(radiusRef, signal)), w, h))
      const rate = 0.35
      const ax = resolveAnimatableFloat(freqXRef, signal) * rate * signal.t
      const ay = resolveAnimatableFloat(freqYRef, signal) * rate * signal.t
      const az = resolveAnimatableFloat(freqZRef, signal) * rate * signal.t
      const size = Math.max(0, resolveAnimatableFloat(ampRef, signal)) * viewportMinDim(w, h)
      const specular = Math.max(0, Math.min(2, resolveAnimatableFloat(specularRef, signal)))

      // Hold each shape, then ease into the next over the last 40% of its period.
      const cycle = signal.t / morphPeriod
      const index = Math.floor(cycle)
      const local = cycle - index
      const blend = smoothstep(0.6, 1, local)
      const from = shapes[((index % shapes.length) + shapes.length) % shapes.length]!
      const to = shapes[(((index + 1) % shapes.length) + shapes.length) % shapes.length]!

      const cameraZ = 3.2
      const balls = from.map((p, i) => {
        const q = to[i]!
        const r = rotate3([mix(p[0], q[0], blend), mix(p[1], q[1], blend), mix(p[2], q[2], blend)], ax, ay, az)
        const scale = cameraZ / (r[2] + cameraZ)
        return {
          x: w * 0.5 + r[0] * size * scale,
          y: h * 0.5 + r[1] * size * scale,
          z: r[2],
          scale,
          color: palette[i % palette.length]!,
        }
      }).sort((a, b) => b.z - a.z)

      for (const ball of balls) {
        drawBall(data, w, h, ball.x, ball.y, radius * ball.scale, ball.color, lightDir, specular)
      }
    },
    destroy() {},
  }
}

/** `n` points on a shape of radius ~1. Polyhedra place balls along their edges, vertices first when they fit. */
function makeShape(shape: VectorBallsShape, n: number): Vec3[] {
  switch (shape) {
    case 'cube':
      return alongEdges(CUBE_VERTS.map(v => scale3(v, 0.62)), CUBE_EDGES, n)
    case 'octahedron':
      return alongEdges(OCTA_VERTS, OCTA_EDGES, n)
    case 'ring':
      return Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2
        return [Math.cos(a), Math.sin(a), 0]
      })
    case 'helix':
      return Array.from({ length: n }, (_, i) => {
        const t = i / Math.max(1, n - 1)
        const a = t * Math.PI * 4
        return [Math.cos(a) * 0.7, (t - 0.5) * 1.8, Math.sin(a) * 0.7]
      })
    case 'sphere':
    default:
      // Fibonacci sphere: evenly spread points.
      return Array.from({ length: n }, (_, i) => {
        const y = n === 1 ? 0 : 1 - (i / (n - 1)) * 2
        const r = Math.sqrt(Math.max(0, 1 - y * y))
        const a = i * Math.PI * (3 - Math.sqrt(5))
        return [Math.cos(a) * r, y, Math.sin(a) * r]
      })
  }
}

function alongEdges(verts: Vec3[], edges: [number, number][], n: number): Vec3[] {
  if (n <= verts.length) return verts.slice(0, n)
  const points = verts.slice()
  const extra = n - verts.length
  for (let i = 0; i < extra; i++) {
    const pos = ((i + 0.5) / extra) * edges.length
    const [a, b] = edges[Math.min(edges.length - 1, Math.floor(pos))]!
    const t = pos - Math.floor(pos)
    const va = verts[a]!
    const vb = verts[b]!
    points.push([mix(va[0], vb[0], t), mix(va[1], vb[1], t), mix(va[2], vb[2], t)])
  }
  return points
}

function drawBall(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  cx: number,
  cy: number,
  radius: number,
  color: number[],
  lightDir: Vec3,
  specular: number,
): void {
  const r = Math.max(1, Math.round(radius))
  for (let yy = -r; yy <= r; yy++) {
    for (let xx = -r; xx <= r; xx++) {
      const x = Math.round(cx + xx)
      const y = Math.round(cy + yy)
      if (x < 0 || y < 0 || x >= w || y >= h) continue
      const nx = xx / r
      const ny = yy / r
      const d2 = nx * nx + ny * ny
      if (d2 > 1) continue
      const nz = -Math.sqrt(1 - d2)
      const n: Vec3 = [nx, ny, nz]
      const ln = dot3(n, lightDir)
      const diff = Math.max(0, ln)
      // Phong highlight: reflect the light direction about the normal and compare with the view direction (−z).
      const reflectZ = 2 * ln * nz - lightDir[2]
      const spec = Math.pow(Math.max(0, -reflectZ), 24) * specular
      const shade = 0.18 + diff * 0.8
      const o = (y * w + x) * 4
      data[o] = Math.min(255, Math.round((color[0] ?? 180) * shade + 255 * spec))
      data[o + 1] = Math.min(255, Math.round((color[1] ?? 190) * shade + 255 * spec))
      data[o + 2] = Math.min(255, Math.round((color[2] ?? 210) * shade + 255 * spec))
      data[o + 3] = 255
    }
  }
}

function rotate3([x0, y0, z0]: Vec3, ax: number, ay: number, az: number): Vec3 {
  let x = x0
  let y = y0
  let z = z0
  let c = Math.cos(ax)
  let s = Math.sin(ax)
  ;[y, z] = [y * c - z * s, y * s + z * c]
  c = Math.cos(ay)
  s = Math.sin(ay)
  ;[x, z] = [x * c + z * s, -x * s + z * c]
  c = Math.cos(az)
  s = Math.sin(az)
  ;[x, y] = [x * c - y * s, x * s + y * c]
  return [x, y, z]
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

function scale3(v: Vec3, k: number): Vec3 {
  return [v[0] * k, v[1] * k, v[2] * k]
}

function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function normalize3(v: Vec3): Vec3 {
  const l = Math.max(1e-6, Math.sqrt(dot3(v, v)))
  return [v[0] / l, v[1] / l, v[2] / l]
}
