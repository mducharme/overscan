import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Generator,
  type NodeContext,
  type Signal,
} from '@overscan/types'

export interface MatrixRainConfig {
  charset?: 'katakana' | 'ascii' | 'binary' | 'hex' | string
  color?: string
  headColor?: string
  speed?: AnimatableFloat
  density?: AnimatableFloat
  trailLength?: AnimatableFloat
  fontSize?: number
  glitch?: AnimatableFloat
}

const SETS = {
  katakana: 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉ0123456789',
  ascii: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  binary: '01',
  hex: '0123456789ABCDEF',
}

interface Column { phase: number; speed: number }

export function MatrixRainGenerator(config: Partial<MatrixRainConfig> = {}): Generator {
  const charset = SETS[config.charset as keyof typeof SETS] ?? (typeof config.charset === 'string' ? config.charset : SETS.katakana)
  const color = hexToRgb(config.color ?? '#00ff41')
  const headColor = hexToRgb(config.headColor ?? '#ffffff')
  const speedRef = config.speed ?? 1
  const densityRef = config.density ?? 0.7
  const trailRef = config.trailLength ?? 0.3
  const fontSize = Math.max(6, Math.min(32, Math.round(config.fontSize ?? 16)))
  const glitchRef = config.glitch ?? 0.02
  let columns: Column[] = []
  let cols = 0

  return {
    type: 'generator',
    id: 'matrix-rain',
    renderers: ['cpu'],
    config: config as Generator['config'],
    init() { columns = []; cols = 0 },
    render(_ctx: NodeContext, out: FrameBuffer, signal: Signal): void {
      const { width: w, height: h, data } = out
      const cellW = Math.max(6, Math.floor(fontSize * 0.7))
      const cellH = fontSize
      const nextCols = Math.max(1, Math.floor(w / cellW))
      if (nextCols !== cols) {
        cols = nextCols
        columns = Array.from({ length: cols }, (_, i) => ({ phase: i * 0.37, speed: 0.6 + (i % 5) * 0.12 }))
      }
      data.fill(0)
      const density = Math.max(0, Math.min(1, resolveAnimatableFloat(densityRef, signal)))
      const speed = Math.max(0.05, resolveAnimatableFloat(speedRef, signal))
      const trail = Math.max(0.05, Math.min(1, resolveAnimatableFloat(trailRef, signal)))
      const glitch = Math.max(0, Math.min(1, resolveAnimatableFloat(glitchRef, signal)))
      for (let c = 0; c < cols; c++) {
        if ((c / Math.max(1, cols - 1)) > density) continue
        const col = columns[c]!
        const head = ((signal.t * speed * col.speed + col.phase) * cellH * 4) % (h + cellH * 12)
        const rows = Math.ceil((h * trail) / cellH)
        for (let r = 0; r < rows; r++) {
          const y = Math.round(head - r * cellH)
          if (y < -cellH || y >= h) continue
          const x = c * cellW
          const t = 1 - r / Math.max(1, rows)
          const useHead = r === 0
          const char = charset[Math.floor(Math.abs(Math.sin(signal.t * 13 + c * 7 + r * 3)) * charset.length) % charset.length] ?? '#'
          const drawChar = Math.random() < glitch ? charset[(c + r) % charset.length] ?? char : char
          drawGlyph(data, w, h, x, y, cellW - 1, cellH - 1, drawChar, useHead ? headColor : tint(color, t * t))
        }
      }
    },
    destroy() { columns = []; cols = 0 },
  }
}

function drawGlyph(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  x0: number,
  y0: number,
  gw: number,
  gh: number,
  char: string,
  color: [number, number, number],
): void {
  const code = char.charCodeAt(0) || 35
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const dx = x0 + x
      const dy = y0 + y
      if (dx < 0 || dy < 0 || dx >= w || dy >= h) continue
      const on = (((x * 17 + y * 31 + code) ^ (code * 13)) & 7) < 3
      if (!on) continue
      const o = (dy * w + dx) * 4
      data[o] = Math.max(data[o] ?? 0, color[0])
      data[o + 1] = Math.max(data[o + 1] ?? 0, color[1])
      data[o + 2] = Math.max(data[o + 2] ?? 0, color[2])
      data[o + 3] = 255
    }
  }
}

function tint(color: [number, number, number], t: number): [number, number, number] {
  return [Math.round(color[0] * t), Math.round(color[1] * t), Math.round(color[2] * t)]
}

function hexToRgb(hex: string): [number, number, number] {
  const s = hex.replace('#', '')
  const n = parseInt(s.length === 3 ? s.split('').map(c => c + c).join('') : s, 16)
  return [Number.isFinite(n) ? (n >> 16) & 0xff : 0, Number.isFinite(n) ? (n >> 8) & 0xff : 255, Number.isFinite(n) ? n & 0xff : 65]
}
