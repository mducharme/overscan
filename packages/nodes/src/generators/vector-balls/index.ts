import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Generator,
  type NodeContext,
  type Signal,
} from '@overscan/types'
import { scaleThickness } from '../../viewport-scale.js'

export interface VectorBallsConfig {
  count?: number
  radius?: AnimatableFloat
  freqX?: AnimatableFloat
  freqY?: AnimatableFloat
  freqZ?: AnimatableFloat
  amplitude?: AnimatableFloat
  phaseSpread?: number
  lightDir?: [number, number, number]
  palette?: number[][]
  specular?: AnimatableFloat
}

const DEFAULT_PALETTE = [
  [150, 158, 176],
  [176, 186, 202],
  [206, 214, 228],
]

export function VectorBallsGenerator(config: Partial<VectorBallsConfig> = {}): Generator {
  const count = Math.max(1, Math.min(24, Math.round(config.count ?? 8)))
  const radiusRef = config.radius ?? 40
  const freqXRef = config.freqX ?? 2
  const freqYRef = config.freqY ?? 3
  const freqZRef = config.freqZ ?? 1
  const ampRef = config.amplitude ?? 0.35
  const phaseSpread = config.phaseSpread ?? 1
  const lightDir = normalize3(config.lightDir ?? [1, 1, -1])
  const palette = config.palette ?? DEFAULT_PALETTE
  const specularRef = config.specular ?? 0.8
  return {
    type: 'generator',
    id: 'vector-balls',
    renderers: ['cpu'],
    config: config as Generator['config'],
    init() {},
    render(_ctx: NodeContext, out: FrameBuffer, signal: Signal): void {
      const { width: w, height: h, data } = out
      data.fill(0)
      const radius = Math.max(
        2,
        scaleThickness(Math.max(4, resolveAnimatableFloat(radiusRef, signal)), w, h),
      )
      const fx = resolveAnimatableFloat(freqXRef, signal)
      const fy = resolveAnimatableFloat(freqYRef, signal)
      const fz = resolveAnimatableFloat(freqZRef, signal)
      const amp = Math.max(0, Math.min(0.48, resolveAnimatableFloat(ampRef, signal)))
      const specular = Math.max(0, Math.min(2, resolveAnimatableFloat(specularRef, signal)))
      const balls = Array.from({ length: count }, (_, i) => {
        const phase = i * phaseSpread
        return {
          x: w * 0.5 + Math.sin(signal.t * fx + phase) * w * amp,
          y: h * 0.5 + Math.sin(signal.t * fy + phase * 1.27) * h * amp * 0.7,
          z: Math.sin(signal.t * fz + phase * 0.73) * 0.5 + 0.5,
          color: palette[i % palette.length] ?? DEFAULT_PALETTE[i % DEFAULT_PALETTE.length]!,
        }
      }).sort((a, b) => a.z - b.z)
      for (const ball of balls) {
        drawBall(data, w, h, ball.x, ball.y, radius * (0.7 + ball.z * 0.55), ball.color, lightDir, specular)
      }
    },
    destroy() {},
  }
}

function drawBall(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  cx: number,
  cy: number,
  radius: number,
  color: number[],
  lightDir: [number, number, number],
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
      const nz = Math.sqrt(1 - d2)
      const n: [number, number, number] = [nx, ny, nz]
      const diff = Math.max(0, dot3(n, lightDir))
      const view = Math.max(0, nz)
      const spec = Math.pow(Math.max(0, diff * 0.65 + view * 0.35), 18) * specular
      const shade = 0.2 + diff * 0.75 + spec
      const o = (y * w + x) * 4
      data[o] = Math.min(255, Math.round((color[0] ?? 180) * shade))
      data[o + 1] = Math.min(255, Math.round((color[1] ?? 190) * shade))
      data[o + 2] = Math.min(255, Math.round((color[2] ?? 210) * shade))
      data[o + 3] = 255
    }
  }
}

function dot3(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function normalize3(v: [number, number, number]): [number, number, number] {
  const l = Math.max(1e-6, Math.sqrt(dot3(v, v)))
  return [v[0] / l, v[1] / l, v[2] / l]
}
