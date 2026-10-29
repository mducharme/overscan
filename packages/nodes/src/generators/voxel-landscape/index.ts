import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Generator,
  type LoadedImageAsset,
  type NodeContext,
  type Signal,
} from '@overscan/types'

export interface VoxelLandscapeConfig {
  heightmap?: string | 'noise'
  colormap?: string | 'auto'
  horizon?: AnimatableFloat
  scale?: AnimatableFloat
  speed?: AnimatableFloat
  cameraHeight?: AnimatableFloat
  cameraAngle?: AnimatableFloat
  drawDistance?: number
  fogColor?: string
}

export function VoxelLandscapeGenerator(config: Partial<VoxelLandscapeConfig> = {}): Generator {
  const heightmapUrl = config.heightmap && config.heightmap !== 'noise' ? config.heightmap : undefined
  const colormapUrl = config.colormap && config.colormap !== 'auto' ? config.colormap : undefined
  const horizonRef = config.horizon ?? 0.5
  const scaleRef = config.scale ?? 1
  const speedRef = config.speed ?? 1
  const cameraHeightRef = config.cameraHeight ?? 150
  const cameraAngleRef = config.cameraAngle ?? 0
  const drawDistance = Math.max(40, Math.min(600, Math.round(config.drawDistance ?? 300)))
  const fogColor = hexToRgb(config.fogColor ?? '#87ceeb')
  return {
    type: 'generator',
    id: 'voxel-landscape',
    renderers: ['cpu'],
    config: config as Generator['config'],
    init() {},
    render(ctx: NodeContext, out: FrameBuffer, signal: Signal): void {
      const horizon = resolveAnimatableFloat(horizonRef, signal)
      const scale = resolveAnimatableFloat(scaleRef, signal)
      const speed = resolveAnimatableFloat(speedRef, signal)
      const cameraHeight = resolveAnimatableFloat(cameraHeightRef, signal)
      const cameraAngle = resolveAnimatableFloat(cameraAngleRef, signal)
      const time = signal.t * speed
      const heightmap = heightmapUrl ? ctx.assets?.getImage(heightmapUrl) : undefined
      const colormap = colormapUrl ? ctx.assets?.getImage(colormapUrl) : undefined
      const { width: w, height: h, data } = out
      const horizonY = Math.round(h * horizon)
      for (let y = 0; y < h; y++) {
        const skyT = y / Math.max(1, horizonY)
        const sky = y <= horizonY ? blend(mul(fogColor, 0.45), fogColor, skyT) : fogColor
        for (let x = 0; x < w; x++) {
          const o = (y * w + x) * 4
          data[o] = sky[0]
          data[o + 1] = sky[1]
          data[o + 2] = sky[2]
          data[o + 3] = 255
        }
      }
      // Comanche-style voxel space: sweep depth front to back; at each depth a line perpendicular to
      // the view direction spans the screen, so every column shares that depth (no fisheye).
      const yBuffer = new Float64Array(w).fill(h)
      const forwardX = Math.cos(cameraAngle)
      const forwardY = Math.sin(cameraAngle)
      const travel = time * 22
      const camX = forwardX * travel
      const camY = forwardY * travel
      const halfFov = Math.tan(0.56)
      let visibleColumns = w
      for (let d = 1; d <= drawDistance && visibleColumns > 0; d++) {
        const centerX = camX + forwardX * d
        const centerY = camY + forwardY * d
        const span = d * halfFov
        const fog = Math.max(0, Math.min(1, 1 - d / drawDistance))
        for (let x = 0; x < w; x++) {
          const maxY = yBuffer[x]!
          if (maxY <= 0) continue
          const side = ((x / Math.max(1, w - 1)) * 2 - 1) * span
          const px = centerX - forwardY * side
          const py = centerY + forwardX * side
          const terr = sampleTerrain(heightmap, px, py) * 180 * scale
          const proj = horizonY - ((terr - cameraHeight) / d) * 55
          if (proj >= maxY) continue
          const terrCol = blend(fogColor, sampleTerrainColor(colormap, terr / Math.max(1, 180 * scale)), fog)
          const yStart = Math.max(0, Math.floor(proj))
          const yEnd = Math.min(h - 1, Math.floor(maxY))
          for (let y = yStart; y <= yEnd; y++) {
            const o = (y * w + x) * 4
            data[o] = terrCol[0]
            data[o + 1] = terrCol[1]
            data[o + 2] = terrCol[2]
            data[o + 3] = 255
          }
          yBuffer[x] = proj
          if (proj <= 0) visibleColumns--
        }
      }
    },
    destroy() {},
  }
}

function hashNoise(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123
  return n - Math.floor(n)
}

/** Last lattice cell's corner hashes; consecutive ray samples mostly stay in the same cell. */
interface NoiseCell {
  ix: number
  iy: number
  a: number
  b: number
  c: number
  d: number
}

const terrainCells: NoiseCell[] = [0, 1, 2].map(() => ({ ix: NaN, iy: NaN, a: 0, b: 0, c: 0, d: 0 }))

function noise(x: number, y: number, cell: NoiseCell): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  if (cell.ix !== ix || cell.iy !== iy) {
    cell.ix = ix
    cell.iy = iy
    cell.a = hashNoise(ix, iy)
    cell.b = hashNoise(ix + 1, iy)
    cell.c = hashNoise(ix, iy + 1)
    cell.d = hashNoise(ix + 1, iy + 1)
  }
  return lerp(lerp(cell.a, cell.b, ux), lerp(cell.c, cell.d, ux), uy)
}

function terrain(x: number, y: number): number {
  return noise(x * 0.045, y * 0.045, terrainCells[0]!) * 0.65
    + noise(x * 0.11, y * 0.11, terrainCells[1]!) * 0.25
    + noise(x * 0.23, y * 0.23, terrainCells[2]!) * 0.1
}

function sampleTerrain(image: LoadedImageAsset | undefined, x: number, y: number): number {
  if (!image) return terrain(x, y)
  const u = x * 0.01 - Math.floor(x * 0.01)
  const v = y * 0.01 - Math.floor(y * 0.01)
  const sx = Math.max(0, Math.min(image.width - 1, Math.round(u * (image.width - 1))))
  const sy = Math.max(0, Math.min(image.height - 1, Math.round(v * (image.height - 1))))
  const i = (sy * image.width + sx) * 4
  return ((image.data[i] ?? 0) + (image.data[i + 1] ?? 0) + (image.data[i + 2] ?? 0)) / (255 * 3)
}

function terrainColor(t: number): [number, number, number] {
  const low: [number, number, number] = [18, 36, 61]
  const mid: [number, number, number] = [46, 115, 56]
  const high: [number, number, number] = [184, 173, 115]
  return t < 0.45 ? blend(low, mid, t / 0.45) : blend(mid, high, (t - 0.45) / 0.55)
}

function sampleTerrainColor(
  image: LoadedImageAsset | undefined,
  t: number,
): [number, number, number] {
  if (!image) return terrainColor(t)
  const x = Math.max(0, Math.min(image.width - 1, Math.round(Math.max(0, Math.min(1, t)) * (image.width - 1))))
  const i = x * 4
  return [image.data[i] ?? 0, image.data[i + 1] ?? 0, image.data[i + 2] ?? 0]
}

function blend(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  return [
    Math.round(lerp(a[0], b[0], x)),
    Math.round(lerp(a[1], b[1], x)),
    Math.round(lerp(a[2], b[2], x)),
  ]
}

function mul(a: [number, number, number], v: number): [number, number, number] {
  return [Math.round(a[0] * v), Math.round(a[1] * v), Math.round(a[2] * v)]
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function hexToRgb(hex: string): [number, number, number] {
  const s = hex.replace('#', '')
  const n = parseInt(s.length === 3 ? s.split('').map(c => c + c).join('') : s, 16)
  return [
    Number.isFinite(n) ? (n >> 16) & 0xff : 135,
    Number.isFinite(n) ? (n >> 8) & 0xff : 206,
    Number.isFinite(n) ? n & 0xff : 235,
  ]
}
