import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Generator,
  type NodeContext,
  type Signal,
} from '@overscan/types'

export interface CheckerboardFloorConfig {
  color1?: string
  color2?: string
  horizon?: AnimatableFloat
  cameraHeight?: AnimatableFloat
  tileSize?: AnimatableFloat
  scrollSpeed?: AnimatableFloat
  rotationSpeed?: AnimatableFloat
  fogDistance?: AnimatableFloat
  fogColor?: string
  skyColor?: string
}

export function CheckerboardFloorGenerator(config: Partial<CheckerboardFloorConfig> = {}): Generator {
  const color1 = hexToRgb(config.color1 ?? '#ffffff')
  const color2 = hexToRgb(config.color2 ?? '#000000')
  const horizonRef = config.horizon ?? 0.5
  const cameraHeightRef = config.cameraHeight ?? 1
  const tileSizeRef = config.tileSize ?? 1
  const scrollSpeedRef = config.scrollSpeed ?? 0
  const rotationSpeedRef = config.rotationSpeed ?? 0
  const fogDistanceRef = config.fogDistance ?? 0.6
  const fogColor = hexToRgb(config.fogColor ?? '#000000')
  const skyColor = hexToRgb(config.skyColor ?? '#000000')
  return {
    type: 'generator',
    id: 'checkerboard-floor',
    renderers: ['cpu'],
    config: config,
    init() {},
    render(_ctx: NodeContext, out: FrameBuffer, signal: Signal): void {
      const horizon = Math.max(0.05, Math.min(0.95, resolveAnimatableFloat(horizonRef, signal)))
      const cameraHeight = Math.max(0.05, resolveAnimatableFloat(cameraHeightRef, signal))
      const tileSize = Math.max(0.02, resolveAnimatableFloat(tileSizeRef, signal))
      const scroll = resolveAnimatableFloat(scrollSpeedRef, signal) * signal.t
      const rot = resolveAnimatableFloat(rotationSpeedRef, signal) * signal.t
      const fogDistance = Math.max(0.05, Math.min(1, resolveAnimatableFloat(fogDistanceRef, signal)))
      renderCpu(out, horizon, cameraHeight, tileSize, scroll, rot, fogDistance, color1, color2, fogColor, skyColor)
    },
    destroy() {},
  }
}

/**
 * Flat checkerboard plane in true perspective: each scanline below the horizon is one depth, and
 * world position runs linearly across it, so tile edges stay straight and tiles stay square.
 * Rotation turns the camera (yaw); scroll moves it forward.
 */
function renderCpu(
  out: FrameBuffer,
  horizon: number,
  cameraHeight: number,
  tileSize: number,
  scroll: number,
  rot: number,
  fogDistance: number,
  color1: [number, number, number],
  color2: [number, number, number],
  fogColor: [number, number, number],
  skyColor: [number, number, number],
): void {
  const { width: w, height: h, data } = out
  const horizonY = Math.floor(h * horizon)
  // Focal length in pixels: rows below the horizon map to depth = cameraHeight · focal / (y − horizon).
  const focal = Math.max(1, h - horizonY)
  const cx = (w - 1) / 2
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  for (let y = 0; y < h; y++) {
    const row = y - horizonY
    const depth = row > 0 ? (cameraHeight * focal) / row : 0
    const fog = Math.max(0, Math.min(1, 1 - depth / Math.max(0.1, fogDistance * 24)))
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      let c = skyColor
      if (row > 0) {
        const lateral = ((x - cx) * depth) / focal
        const wx = (lateral * cos - depth * sin) / tileSize
        const wz = (lateral * sin + depth * cos) / tileSize + scroll
        const chk = ((Math.floor(wx) + Math.floor(wz)) & 1) === 0 ? color1 : color2
        c = mixRgb(fogColor, chk, fog)
      }
      data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255
    }
  }
}

function mixRgb(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [Math.round(a[0] + (b[0]-a[0])*t), Math.round(a[1] + (b[1]-a[1])*t), Math.round(a[2] + (b[2]-a[2])*t)]
}

function hexToRgb(hex: string): [number, number, number] {
  const s = hex.replace('#', '')
  const n = parseInt(s.length === 3 ? s.split('').map(c => c + c).join('') : s, 16)
  return [Number.isFinite(n) ? (n >> 16) & 0xff : 255, Number.isFinite(n) ? (n >> 8) & 0xff : 255, Number.isFinite(n) ? n & 0xff : 255]
}
