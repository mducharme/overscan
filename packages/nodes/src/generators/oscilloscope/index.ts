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

export interface OscilloscopeConfig {
  source?: string
  color?: string
  lineWidth?: AnimatableFloat
  triggerMode?: 'free' | 'rising' | 'falling'
  triggerLevel?: AnimatableFloat
  timeScale?: AnimatableFloat
  voltScale?: AnimatableFloat
  persistence?: AnimatableFloat
  gridColor?: string
  gridDivisions?: number
  phosphorColor?: string
}

export function OscilloscopeGenerator(config: Partial<OscilloscopeConfig> = {}): Generator {
  const color = hexToRgb(config.color ?? '#00ff88')
  const lineWidthRef = config.lineWidth ?? 2
  const triggerMode = config.triggerMode ?? 'rising'
  const triggerLevelRef = config.triggerLevel ?? 0
  const timeScaleRef = config.timeScale ?? 1
  const voltScaleRef = config.voltScale ?? 1
  const persistenceRef = config.persistence ?? 0
  const gridColor = hexToRgb(config.gridColor ?? '#1a1a1a')
  const gridDivisions = Math.max(2, Math.min(16, Math.round(config.gridDivisions ?? 8)))
  const phosphorColor = config.phosphorColor ? hexToRgb(config.phosphorColor) : null
  let trail: Uint8ClampedArray | null = null
  let tw = 0
  let th = 0
  return {
    type: 'generator',
    id: 'oscilloscope',
    renderers: ['cpu'],
    config: config,
    init() { trail = null; tw = 0; th = 0 },
    render(_ctx: NodeContext, out: FrameBuffer, signal: Signal): void {
      const { width: w, height: h, data } = out
      if (!trail || tw !== w || th !== h) {
        trail = new Uint8ClampedArray(w * h * 4)
        tw = w; th = h
      }
      const persistence = Math.max(0, Math.min(1, resolveAnimatableFloat(persistenceRef, signal)))
      // The pool hands out cleared buffers, so the previous frame comes from our own trail copy.
      data.set(trail)
      fade(data, persistence, frameSteps(signal))
      drawGrid(data, w, h, gridColor, gridDivisions)
      const lineWidth = scaleThickness(
        Math.max(1, resolveAnimatableFloat(lineWidthRef, signal)),
        w,
        h,
      )
      const triggerLevel = resolveAnimatableFloat(triggerLevelRef, signal)
      const timeScale = Math.max(0.1, resolveAnimatableFloat(timeScaleRef, signal))
      const voltScale = Math.max(0.1, resolveAnimatableFloat(voltScaleRef, signal))
      const samples = Array.from({ length: w }, (_, i) => sampleWave(signal, i / Math.max(1, w - 1), timeScale))
      const start = findTrigger(samples, triggerMode, triggerLevel)
      let prevY = h * 0.5 - (samples[start] ?? 0) * h * 0.3 * voltScale
      for (let x = 1; x < w; x++) {
        const idx = (start + x) % samples.length
        const y = h * 0.5 - samples[idx]! * h * 0.3 * voltScale
        drawLine(data, w, h, x - 1, prevY, x, y, lineWidth, color)
        if (phosphorColor) {
          drawLine(data, w, h, x - 1, prevY, x, y, lineWidth + scaleThickness(2, w, h), tint(phosphorColor, 0.18))
        }
        prevY = y
      }
      trail.set(data)
    },
    destroy() { trail = null },
  }
}

function sampleWave(signal: Signal, x: number, timeScale: number): number {
  const t = signal.t + x * timeScale
  return Math.sin(t * 6.4) * 0.6 + Math.sin(t * 14.1) * 0.25 + Math.sin(t * 2.2 + signal.rms * 4) * 0.15
}

function findTrigger(samples: number[], mode: 'free' | 'rising' | 'falling', level: number): number {
  if (mode === 'free') return 0
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1] ?? 0
    const b = samples[i] ?? 0
    if (mode === 'rising' && a < level && b >= level) return i
    if (mode === 'falling' && a > level && b <= level) return i
  }
  return 0
}

function drawGrid(data: Uint8ClampedArray, w: number, h: number, color: [number, number, number], divs: number): void {
  for (let i = 0; i <= divs; i++) {
    const x = Math.round((i / divs) * (w - 1))
    const y = Math.round((i / divs) * (h - 1))
    for (let yy = 0; yy < h; yy++) setPixel(data, w, x, yy, color, 0.35)
    for (let xx = 0; xx < w; xx++) setPixel(data, w, xx, y, color, 0.35)
  }
}

function fade(data: Uint8ClampedArray, persistence: number, steps: number): void {
  const keep = (persistence * 0.92) ** steps
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.round((data[i] ?? 0) * keep)
    data[i + 1] = Math.round((data[i + 1] ?? 0) * keep)
    data[i + 2] = Math.round((data[i + 2] ?? 0) * keep)
    data[i + 3] = 255
  }
}

function drawLine(data: Uint8ClampedArray, w: number, h: number, x0: number, y0: number, x1: number, y1: number, width: number, color: [number, number, number]): void {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))))
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const x = x0 + (x1 - x0) * t
    const y = y0 + (y1 - y0) * t
    const r = Math.max(1, Math.round(width))
    for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) {
      const d = Math.sqrt(xx * xx + yy * yy)
      if (d <= r) setPixel(data, w, Math.round(x + xx), Math.round(y + yy), color, 1 - d / Math.max(1, r))
    }
  }
}

function setPixel(data: Uint8ClampedArray, w: number, x: number, y: number, color: [number, number, number], alpha: number): void {
  if (x < 0 || y < 0) return
  const idx = (y * w + x) * 4
  if (idx < 0 || idx + 3 >= data.length) return
  data[idx] = Math.min(255, Math.round((data[idx] ?? 0) + color[0] * alpha))
  data[idx + 1] = Math.min(255, Math.round((data[idx + 1] ?? 0) + color[1] * alpha))
  data[idx + 2] = Math.min(255, Math.round((data[idx + 2] ?? 0) + color[2] * alpha))
  data[idx + 3] = 255
}

function tint(color: [number, number, number], t: number): [number, number, number] {
  return [Math.round(color[0] * t), Math.round(color[1] * t), Math.round(color[2] * t)]
}

function hexToRgb(hex: string): [number, number, number] {
  const s = hex.replace('#', '')
  const n = parseInt(s.length === 3 ? s.split('').map(c => c + c).join('') : s, 16)
  return [Number.isFinite(n) ? (n >> 16) & 0xff : 0, Number.isFinite(n) ? (n >> 8) & 0xff : 255, Number.isFinite(n) ? n & 0xff : 136]
}
