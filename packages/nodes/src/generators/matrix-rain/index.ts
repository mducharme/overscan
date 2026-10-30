import { Tiny5x7Font } from '@overscan/text'
import { DEFAULT_RANDOM_SEED, hash01 } from '../../random.js'
import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Generator,
  type NodeContext,
  type Signal,
} from '@overscan/types'

export interface MatrixRainConfig {
  /** Seed for this node's randomness (default 1); vary it to decorrelate identical nodes. */
  randomSeed?: number
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
  // `charset` is a preset name or a literal string of characters.
  const preset = (SETS as Record<string, string | undefined>)[config.charset ?? '']
  const charset = preset ?? (typeof config.charset === 'string' ? config.charset : SETS.katakana)
  const color = hexToRgb(config.color ?? '#00ff41')
  const headColor = hexToRgb(config.headColor ?? '#ffffff')
  const speedRef = config.speed ?? 1
  const densityRef = config.density ?? 0.7
  const trailRef = config.trailLength ?? 0.3
  const fontSize = Math.max(6, Math.min(32, Math.round(config.fontSize ?? 16)))
  const glitchRef = config.glitch ?? 0.02
  const randomSeed = config.randomSeed ?? DEFAULT_RANDOM_SEED
  let columns: Column[] = []
  let cols = 0

  return {
    type: 'generator',
    id: 'matrix-rain',
    renderers: ['cpu'],
    config: config,
    init() { columns = []; cols = 0 },
    render(_ctx: NodeContext, out: FrameBuffer, signal: Signal): void {
      const { width: w, height: h, data } = out
      const cellW = Math.max(6, Math.floor(fontSize * 0.7))
      const cellH = fontSize
      const nextCols = Math.max(1, Math.floor(w / cellW))
      if (nextCols !== cols) {
        cols = nextCols
        columns = Array.from({ length: cols }, (_, i) => ({ phase: hash01(randomSeed, i, 4) * 10, speed: 0.6 + hash01(randomSeed, i, 5) * 0.6 }))
      }
      data.fill(0)
      const density = Math.max(0, Math.min(1, resolveAnimatableFloat(densityRef, signal)))
      const speed = Math.max(0.05, resolveAnimatableFloat(speedRef, signal))
      const trail = Math.max(0.05, Math.min(1, resolveAnimatableFloat(trailRef, signal)))
      const glitch = Math.max(0, Math.min(1, resolveAnimatableFloat(glitchRef, signal)))
      for (let c = 0; c < cols; c++) {
        // Hash-picked columns, so `density` thins the rain evenly instead of emptying one side.
        if (hash01(randomSeed, c, 1) > density) continue
        const col = columns[c]!
        const head = ((signal.t * speed * col.speed + col.phase) * cellH * 4) % (h + cellH * 12)
        const headRow = Math.floor(head / cellH)
        const rows = Math.ceil((h * trail) / cellH)
        const x = c * cellW
        for (let r = 0; r < rows; r++) {
          // Glyphs sit on a fixed screen grid; the bright head moves down and reveals them.
          const row = headRow - r
          const y = row * cellH
          if (y < -cellH || y >= h) continue
          const t = 1 - r / Math.max(1, rows)
          // Each cell keeps its glyph for a while, changing at about 2 Hz with its own offset.
          const epoch = Math.floor(signal.t * 2 + hash01(randomSeed, c, row, 2) * 7)
          const char = charset[Math.floor(hash01(randomSeed, c, row, epoch) * charset.length)] ?? '#'
          // Stateless per glyph and 1/30 s tick, so the glitch pattern is reproducible and seek-safe.
          const drawChar = hash01(randomSeed, c, row, Math.floor(signal.t * 30)) < glitch
            ? charset[Math.floor(hash01(randomSeed, c, row, Math.floor(signal.t * 30), 3) * charset.length)] ?? char
            : char
          drawGlyph(data, w, h, x, y, cellW - 1, cellH - 1, drawChar, r === 0 ? headColor : tint(color, t * t))
        }
      }
    },
    destroy() { columns = []; cols = 0 },
  }
}

/** Draws `char` scaled into a gw × gh cell: the bitmap font's glyph when it has one, else a synthetic kana-like glyph. */
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
  const rows = glyphFor(char)
  for (let y = 0; y < gh; y++) {
    const row = rows[Math.min(GLYPH_H - 1, Math.floor((y * GLYPH_H) / gh))]!
    for (let x = 0; x < gw; x++) {
      if (row[Math.min(GLYPH_W - 1, Math.floor((x * GLYPH_W) / gw))] !== '1') continue
      const dx = x0 + x
      const dy = y0 + y
      if (dx < 0 || dy < 0 || dx >= w || dy >= h) continue
      const o = (dy * w + dx) * 4
      data[o] = Math.max(data[o] ?? 0, color[0])
      data[o + 1] = Math.max(data[o + 1] ?? 0, color[1])
      data[o + 2] = Math.max(data[o + 2] ?? 0, color[2])
      data[o + 3] = 255
    }
  }
}

const GLYPH_W = Tiny5x7Font.glyphWidth
const GLYPH_H = Tiny5x7Font.glyphHeight
const glyphCache = new Map<string, string[]>()

function glyphFor(char: string): string[] {
  let rows = glyphCache.get(char)
  if (!rows) {
    rows = Tiny5x7Font.glyphs[char.toUpperCase()] ?? syntheticGlyph(char.codePointAt(0) ?? 35)
    glyphCache.set(char, rows)
  }
  return rows
}

/** Kana-like strokes on the 5×7 grid, mirrored as in the film; picked by the character code. */
const STROKES: [number, number, number, number][] = [
  [0, 0, 4, 0], [0, 3, 4, 3], [1, 6, 4, 6], [2, 0, 2, 6], [4, 0, 4, 4],
  [4, 1, 0, 6], [0, 1, 2, 3], [3, 3, 4, 6], [1, 0, 1, 3], [0, 6, 4, 6],
]

function syntheticGlyph(code: number): string[] {
  const grid = Array.from({ length: GLYPH_H }, () => Array<string>(GLYPH_W).fill('0'))
  let bits = Math.imul(code ^ 0x9e3779b9, 0x85ebca6b) >>> 0
  let drawn = 0
  for (let i = 0; i < STROKES.length && drawn < 4; i++, bits >>>= 3) {
    if ((bits & 7) > 2 && drawn >= 2) continue
    const [ax, ay, bx, by] = STROKES[(i + code) % STROKES.length]!
    const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay))
    for (let s = 0; s <= steps; s++) {
      const x = Math.round(ax + ((bx - ax) * s) / Math.max(1, steps))
      const y = Math.round(ay + ((by - ay) * s) / Math.max(1, steps))
      grid[y]![GLYPH_W - 1 - x] = '1'
    }
    drawn++
  }
  return grid.map(r => r.join(''))
}

function tint(color: [number, number, number], t: number): [number, number, number] {
  return [Math.round(color[0] * t), Math.round(color[1] * t), Math.round(color[2] * t)]
}

function hexToRgb(hex: string): [number, number, number] {
  const s = hex.replace('#', '')
  const n = parseInt(s.length === 3 ? s.split('').map(c => c + c).join('') : s, 16)
  return [Number.isFinite(n) ? (n >> 16) & 0xff : 0, Number.isFinite(n) ? (n >> 8) & 0xff : 255, Number.isFinite(n) ? n & 0xff : 65]
}
