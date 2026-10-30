import { frameSteps } from '../../frame-time.js'
import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Generator,
  type NodeContext,
  type Signal,
} from '@overscan/types'
import { scaleThickness } from '../../viewport-scale.js'

export interface LissajousConfig {
  a?: AnimatableFloat
  b?: AnimatableFloat
  delta?: AnimatableFloat
  amplitude?: AnimatableFloat
  trailLength?: number
  decay?: AnimatableFloat
  color?: string
  lineWidth?: AnimatableFloat
  glow?: AnimatableFloat
}

export function LissajousGenerator(config: Partial<LissajousConfig> = {}): Generator {
  const aRef = config.a ?? 3
  const bRef = config.b ?? 2
  const deltaRef = config.delta ?? 0
  const ampRef = config.amplitude ?? 0.8
  const decayRef = config.decay ?? 0.95
  const lineWidthRef = config.lineWidth ?? 1
  const glowRef = config.glow ?? 0
  const trailLength = Math.max(32, Math.min(4096, Math.round(config.trailLength ?? 512)))
  const color = hexToRgb(config.color ?? '#00ff88')
  let trail: Uint8ClampedArray | null = null
  let tw = 0
  let th = 0

  return {
    type: 'generator',
    id: 'lissajous',
    renderers: ['cpu'],
    config: config,
    init() {
      trail = null
      tw = 0
      th = 0
    },
    destroy() {
      trail = null
      tw = 0
      th = 0
    },
    render(_ctx: NodeContext, out: FrameBuffer, signal: Signal): void {
      const { width: w, height: h, data } = out
      if (!trail || tw !== w || th !== h) {
        trail = new Uint8ClampedArray(w * h * 4)
        tw = w
        th = h
      }
      const a = resolveAnimatableFloat(aRef, signal)
      const b = resolveAnimatableFloat(bRef, signal)
      const delta = resolveAnimatableFloat(deltaRef, signal)
      const amplitude = Math.max(0, Math.min(1, resolveAnimatableFloat(ampRef, signal)))
      const decay = Math.max(0, Math.min(1, resolveAnimatableFloat(decayRef, signal)))
      const lineWidth = scaleThickness(
        Math.max(1, resolveAnimatableFloat(lineWidthRef, signal)),
        w,
        h,
      )
      const glow = Math.max(0, Math.min(1, resolveAnimatableFloat(glowRef, signal)))

      fadeTrail(trail, decay ** frameSteps(signal))
      const cx = w * 0.5
      const cy = h * 0.5
      const ampX = cx * amplitude
      const ampY = cy * amplitude
      const phaseSpeed = Math.max(0.2, Math.sqrt(Math.abs(a * b)) * 0.35)
      let prevX = cx + Math.sin(delta) * ampX
      let prevY = cy

      for (let i = 1; i < trailLength; i++) {
        const t = signal.t * phaseSpeed + (i / Math.max(1, trailLength - 1)) * Math.PI * 2
        const x = cx + Math.sin(a * t + delta) * ampX
        const y = cy + Math.sin(b * t) * ampY
        const alpha = i / trailLength
        drawLine(trail, w, h, prevX, prevY, x, y, lineWidth, color, alpha, glow)
        prevX = x
        prevY = y
      }

      data.set(trail)
    },
  }
}

function fadeTrail(data: Uint8ClampedArray, decay: number): void {
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.round((data[i] ?? 0) * decay)
    data[i + 1] = Math.round((data[i + 1] ?? 0) * decay)
    data[i + 2] = Math.round((data[i + 2] ?? 0) * decay)
    data[i + 3] = Math.round((data[i + 3] ?? 0) * decay)
  }
}

function drawLine(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  color: [number, number, number],
  alpha: number,
  glow: number,
): void {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))))
  const radius = Math.max(1, Math.round(width + glow * 2))
  for (let s = 0; s <= steps; s++) {
    const t = s / steps
    const x = x0 + (x1 - x0) * t
    const y = y0 + (y1 - y0) * t
    stamp(data, w, h, x, y, radius, color, alpha, glow)
  }
}

function stamp(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  cx: number,
  cy: number,
  radius: number,
  color: [number, number, number],
  alpha: number,
  glow: number,
): void {
  const r = Math.max(1, radius)
  for (let yy = -r; yy <= r; yy++) {
    for (let xx = -r; xx <= r; xx++) {
      const x = Math.round(cx + xx)
      const y = Math.round(cy + yy)
      if (x < 0 || y < 0 || x >= w || y >= h) continue
      const d = Math.sqrt(xx * xx + yy * yy)
      if (d > r) continue
      const falloff = Math.max(0, 1 - d / r)
      const intensity = Math.min(1, alpha * (falloff + glow * 0.25 * falloff))
      const i = (y * w + x) * 4
      data[i] = Math.min(255, Math.round((data[i] ?? 0) + color[0] * intensity))
      data[i + 1] = Math.min(255, Math.round((data[i + 1] ?? 0) + color[1] * intensity))
      data[i + 2] = Math.min(255, Math.round((data[i + 2] ?? 0) + color[2] * intensity))
      data[i + 3] = Math.min(255, Math.round((data[i + 3] ?? 0) + 255 * intensity))
    }
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const s = hex.replace('#', '')
  const n = parseInt(s.length === 3 ? s.split('').map(c => c + c).join('') : s, 16)
  return [
    Number.isFinite(n) ? (n >> 16) & 0xff : 0,
    Number.isFinite(n) ? (n >> 8) & 0xff : 255,
    Number.isFinite(n) ? n & 0xff : 136,
  ]
}
