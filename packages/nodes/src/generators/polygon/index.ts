import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Generator,
  type LoadedImageAsset,
  type NodeContext,
  type Signal,
} from '@overscan/types'
import { fillRgb, hexToRgb, readPalette, type Rgb } from '../../color.js'
import { scaleFovMultiplier } from '../../viewport-scale.js'
import { builtinMesh, cross, dot, normalize, sub, vertexNormals, type MeshName, type Vec3 } from './mesh.js'

export interface PolygonConfig {
  mesh?: MeshName
  /** flat: one colour per face. gouraud: smooth lighting with a highlight. envmap: chrome-like reflection of `textureUrl` (or a built-in sky). */
  shading?: 'flat' | 'gouraud' | 'envmap'
  /** Face colours for flat shading (cycled), and the base colour (first entry) for gouraud. */
  palette?: number[][]
  /** Reflection picture for envmap shading. */
  textureUrl?: string
  /** Light that is always present, 0–1. */
  ambient?: AnimatableFloat
  /** Rotation speeds in radians per second. */
  rotationX?: AnimatableFloat
  rotationY?: AnimatableFloat
  rotationZ?: AnimatableFloat
  scale?: AnimatableFloat
  /** Object centre, 0–1 of the frame. */
  x?: AnimatableFloat
  y?: AnimatableFloat
  fov?: AnimatableFloat
  cameraZ?: AnimatableFloat
  /**
   * Rubber (jelly) vector: how many seconds the rotation of the object's top lags behind its bottom,
   * so it wobbles like jelly. 0 is rigid.
   */
  rubber?: AnimatableFloat
  /** 'transparent' (default) leaves the background clear for compositing. */
  backgroundColor?: string
}

const PALETTE: Rgb[] = [[255, 92, 160], [80, 200, 255], [255, 210, 80], [140, 90, 255], [70, 230, 160], [255, 130, 60]]

/** A built-in reflection map: sky gradient, bright horizon and a dark checkered floor (the chrome look). */
function chromeMap(): LoadedImageAsset {
  const width = 128
  const height = 128
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    const v = y / (height - 1)
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      let r: number, g: number, b: number
      if (v < 0.5) {
        const k = v / 0.5
        r = 30 + 200 * k ** 3; g = 60 + 180 * k ** 2; b = 140 + 115 * k
      } else {
        const k = (v - 0.5) / 0.5
        const check = ((Math.floor(x / 16) + Math.floor(y / 8)) & 1) === 0
        const base = check ? 90 : 40
        r = base * (1 - k) + 255 * Math.max(0, 0.06 - k) * 12; g = base * 0.8 * (1 - k); b = base * 0.6 * (1 - k)
      }
      data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255
    }
  }
  return { width, height, data }
}

const rotate = (v: Vec3, ax: number, ay: number, az: number): Vec3 => {
  let [x, y, z] = v
  let c = Math.cos(ax), s = Math.sin(ax)
  ;[y, z] = [y * c - z * s, y * s + z * c]
  c = Math.cos(ay); s = Math.sin(ay)
  ;[x, z] = [x * c + z * s, -x * s + z * c]
  c = Math.cos(az); s = Math.sin(az)
  ;[x, y] = [x * c - y * s, x * s + y * c]
  return [x, y, z]
}

/**
 * Solid 3D objects: built-in meshes (cube, glenz, icosahedron, sphere, torus, torus knot) with flat,
 * Gouraud or environment-mapped shading, a depth buffer, and an optional rubber (jelly) wobble.
 */
export function PolygonGenerator(config: Partial<PolygonConfig> = {}): Generator {
  const mesh = builtinMesh(config.mesh ?? 'torus-knot')
  const normals = vertexNormals(mesh)
  const shading = config.shading ?? 'gouraud'
  const palette = readPalette(config.palette, PALETTE)
  const background = config.backgroundColor && config.backgroundColor !== 'transparent' ? hexToRgb(config.backgroundColor, [0, 0, 0]) : null
  const ambientRef = config.ambient ?? 0.18
  const rxRef = config.rotationX ?? 0.6
  const ryRef = config.rotationY ?? 0.9
  const rzRef = config.rotationZ ?? 0.25
  const scaleRef = config.scale ?? 1
  const xRef = config.x ?? 0.5
  const yRef = config.y ?? 0.5
  const fovRef = config.fov ?? 420
  const cameraZRef = config.cameraZ ?? 2.8
  const rubberRef = config.rubber ?? 0
  const light = normalize([-0.45, 0.55, -0.7])
  const half = normalize([light[0], light[1], light[2] - 1])
  let builtinEnv: LoadedImageAsset | null = null
  let depth = new Float32Array(0)

  return {
    type: 'generator',
    id: 'polygon',
    renderers: ['cpu'],
    config: config,
    init() {},
    destroy() { builtinEnv = null },
    render(ctx: NodeContext, out: FrameBuffer, signal: Signal): void {
      const { width: w, height: h, data } = out
      if (background) fillRgb(data, background)
      else data.fill(0)
      if (depth.length !== w * h) depth = new Float32Array(w * h)
      depth.fill(Infinity)
      const t = signal.t
      const rx = resolveAnimatableFloat(rxRef, signal)
      const ry = resolveAnimatableFloat(ryRef, signal)
      const rz = resolveAnimatableFloat(rzRef, signal)
      const scale = resolveAnimatableFloat(scaleRef, signal)
      const camZ = Math.max(1.2, resolveAnimatableFloat(cameraZRef, signal))
      const fov = scaleFovMultiplier(resolveAnimatableFloat(fovRef, signal), w, h)
      const ox = resolveAnimatableFloat(xRef, signal) * w
      const oy = resolveAnimatableFloat(yRef, signal) * h
      const rubber = resolveAnimatableFloat(rubberRef, signal)
      const ambient = Math.max(0, Math.min(1, resolveAnimatableFloat(ambientRef, signal)))
      const env = shading === 'envmap'
        ? (config.textureUrl ? ctx.assets?.getImage(config.textureUrl) : undefined) ?? (builtinEnv ??= chromeMap())
        : null

      // Transform: each vertex rotates at its own (lagged) time when rubber is on.
      const n = mesh.verts.length
      const view = new Array<Vec3>(n)
      const vnorm = new Array<Vec3>(n)
      const sx = new Float32Array(n), sy = new Float32Array(n), sz = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        const v = mesh.verts[i]!
        const tv = t - rubber * (v[1] + 1) * 0.5
        const p = rotate([v[0] * scale, v[1] * scale, v[2] * scale], rx * tv, ry * tv, rz * tv)
        view[i] = p
        vnorm[i] = rotate(normals[i]!, rx * tv, ry * tv, rz * tv)
        const z = p[2] + camZ
        sz[i] = z
        sx[i] = ox + (p[0] * fov) / z
        sy[i] = oy - (p[1] * fov) / z
      }

      const col: Rgb = [0, 0, 0]
      for (let f = 0; f < mesh.tris.length; f++) {
        const [a, b, c] = mesh.tris[f]!
        if (sz[a]! < 0.05 || sz[b]! < 0.05 || sz[c]! < 0.05) continue
        const pa = view[a]!, pb = view[b]!, pc = view[c]!
        const faceN = normalize(cross(sub(pb, pa), sub(pc, pa)))
        // Back faces point away from the camera (at the origin, looking down +z).
        if (dot(faceN, [pa[0], pa[1], pa[2] + camZ]) >= 0) continue
        const base = shading === 'flat' ? palette[f % palette.length]! : palette[0]!
        const flatLight = ambient + (1 - ambient) * Math.max(0, dot(faceN, light))

        // Per-vertex values to interpolate: intensity (gouraud), reflection uv (envmap).
        const shadeAt = (i: number): [number, number, number] => {
          const nv = vnorm[i]!
          if (shading === 'envmap') return [0.5 + nv[0] * 0.48, 0.5 - nv[1] * 0.48, 0]
          const diffuse = Math.max(0, dot(nv, light))
          const spec = Math.pow(Math.max(0, dot(nv, half)), 28)
          return [ambient + (1 - ambient) * diffuse, spec, 0]
        }
        const va = shadeAt(a), vb = shadeAt(b), vc = shadeAt(c)

        const x0 = sx[a]!, y0 = sy[a]!, x1 = sx[b]!, y1 = sy[b]!, x2 = sx[c]!, y2 = sy[c]!
        const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
        if (Math.abs(area) < 1e-6) continue
        const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)))
        const maxX = Math.min(w - 1, Math.ceil(Math.max(x0, x1, x2)))
        const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)))
        const maxY = Math.min(h - 1, Math.ceil(Math.max(y0, y1, y2)))
        const iza = 1 / sz[a]!, izb = 1 / sz[b]!, izc = 1 / sz[c]!
        for (let y = minY; y <= maxY; y++) {
          const py = y + 0.5
          for (let x = minX; x <= maxX; x++) {
            const px = x + 0.5
            const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) / area
            const w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) / area
            const w2 = 1 - w0 - w1
            if (w0 < 0 || w1 < 0 || w2 < 0) continue
            const iz = w0 * iza + w1 * izb + w2 * izc
            const z = 1 / iz
            const di = y * w + x
            if (z >= depth[di]!) continue
            depth[di] = z
            // Perspective-correct weights for the interpolated attributes.
            const pw0 = (w0 * iza) * z, pw1 = (w1 * izb) * z, pw2 = (w2 * izc) * z
            const o = di * 4
            if (shading === 'flat') {
              col[0] = base[0] * flatLight; col[1] = base[1] * flatLight; col[2] = base[2] * flatLight
            } else if (env) {
              const u = pw0 * va[0] + pw1 * vb[0] + pw2 * vc[0]
              const v = pw0 * va[1] + pw1 * vb[1] + pw2 * vc[1]
              const ex = Math.max(0, Math.min(env.width - 1, Math.floor(u * env.width)))
              const ey = Math.max(0, Math.min(env.height - 1, Math.floor(v * env.height)))
              const e = (ey * env.width + ex) * 4
              // Tint the reflection with the base colour a little, so palettes still matter.
              col[0] = env.data[e]! * (0.75 + 0.25 * base[0] / 255)
              col[1] = env.data[e + 1]! * (0.75 + 0.25 * base[1] / 255)
              col[2] = env.data[e + 2]! * (0.75 + 0.25 * base[2] / 255)
            } else {
              const li = pw0 * va[0] + pw1 * vb[0] + pw2 * vc[0]
              const sp = (pw0 * va[1] + pw1 * vb[1] + pw2 * vc[1]) * 255
              col[0] = base[0] * li + sp; col[1] = base[1] * li + sp; col[2] = base[2] * li + sp
            }
            data[o] = col[0]; data[o + 1] = col[1]; data[o + 2] = col[2]; data[o + 3] = 255
          }
        }
      }
    },
  }
}
