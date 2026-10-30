import { resolveBitmapFont } from '@overscan/text'
import type { FrameBuffer, Modifier, NodeContext } from '@overscan/types'

export interface AnsiArtConfig {
  charset?: 'block' | 'ascii' | 'braille' | 'custom'
  customChars?: string
  colorMode?: '24bit' | '256' | 'mono'
  dither?: boolean
}

type CellStyle =
  | { type: 'font'; chars: string; cellWidth: number; cellHeight: number }
  | { type: 'block'; levels: number; cellWidth: number; cellHeight: number }
  | { type: 'braille'; cellWidth: number; cellHeight: number }

const ASCII_FONT = resolveBitmapFont('overscan://fonts/Tiny5x7')
const ASCII_PALETTE = ' .:-=+*#%@'

export function AnsiArtModifier(config: Partial<AnsiArtConfig> = {}): Modifier {
  const charset = config.charset ?? 'block'
  const colorMode = config.colorMode ?? '24bit'
  const dither = config.dither ?? false

  return {
    type: 'modifier',
    id: 'ansi-art',
    persistent: false,
    config: config,
    init() {},
    destroy() {},
    apply(ctx: NodeContext, input: FrameBuffer, out: FrameBuffer): void {
      const style = buildStyle(charset, config.customChars)
      const cellsX = Math.max(1, Math.ceil(input.width / style.cellWidth))
      const cellsY = Math.max(1, Math.ceil(input.height / style.cellHeight))
      const cells = sampleCells(input, cellsX, cellsY, style.cellWidth, style.cellHeight)

      if (dither) ditherCells(cells, cellsX, cellsY, style)

      out.data.fill(0)
      for (let cy = 0; cy < cellsY; cy++) {
        for (let cx = 0; cx < cellsX; cx++) {
          const cell = cells[cy * cellsX + cx]
          if (!cell) continue
          const color = quantizeColor(cell.color, colorMode)
          renderCell(out.data, out.width, out.height, cx * style.cellWidth, cy * style.cellHeight, style, cell.level, color)
        }
      }

      uploadTexture(ctx, out)
    },
  }
}

interface CellSample {
  level: number
  color: [number, number, number]
}

function buildStyle(charset: NonNullable<AnsiArtConfig['charset']>, customChars?: string): CellStyle {
  switch (charset) {
    case 'ascii':
      return { type: 'font', chars: ASCII_PALETTE, cellWidth: 6, cellHeight: 8 }
    case 'custom':
      return { type: 'font', chars: customChars && customChars.length > 0 ? customChars : ASCII_PALETTE, cellWidth: 6, cellHeight: 8 }
    case 'braille':
      return { type: 'braille', cellWidth: 4, cellHeight: 8 }
    case 'block':
    default:
      return { type: 'block', levels: 5, cellWidth: 4, cellHeight: 4 }
  }
}

function sampleCells(frame: FrameBuffer, cellsX: number, cellsY: number, cellWidth: number, cellHeight: number): CellSample[] {
  const cells = new Array<CellSample>(cellsX * cellsY)
  for (let cy = 0; cy < cellsY; cy++) {
    for (let cx = 0; cx < cellsX; cx++) {
      let r = 0
      let g = 0
      let b = 0
      let count = 0
      for (let yy = 0; yy < cellHeight; yy++) {
        const py = cy * cellHeight + yy
        if (py >= frame.height) continue
        for (let xx = 0; xx < cellWidth; xx++) {
          const px = cx * cellWidth + xx
          if (px >= frame.width) continue
          const i = (py * frame.width + px) * 4
          r += frame.data[i] ?? 0
          g += frame.data[i + 1] ?? 0
          b += frame.data[i + 2] ?? 0
          count++
        }
      }
      const color: [number, number, number] = count > 0
        ? [Math.round(r / count), Math.round(g / count), Math.round(b / count)]
        : [0, 0, 0]
      const lum = ((0.299 * color[0]) + (0.587 * color[1]) + (0.114 * color[2])) / 255
      cells[cy * cellsX + cx] = { level: lum, color }
    }
  }
  return cells
}

function ditherCells(cells: CellSample[], cellsX: number, cellsY: number, style: CellStyle): void {
  const maxLevel = style.type === 'block'
    ? Math.max(1, style.levels - 1)
    : style.type === 'braille'
      ? 8
      : Math.max(1, style.chars.length - 1)
  for (let cy = 0; cy < cellsY; cy++) {
    for (let cx = 0; cx < cellsX; cx++) {
      const idx = cy * cellsX + cx
      const cell = cells[idx]
      if (!cell) continue
      const scaled = cell.level * maxLevel
      const quantized = Math.round(scaled)
      const newLevel = quantized / maxLevel
      const err = cell.level - newLevel
      cell.level = Math.max(0, Math.min(1, newLevel))
      distributeError(cells, cellsX, cellsY, cx + 1, cy, err * 7 / 16)
      distributeError(cells, cellsX, cellsY, cx - 1, cy + 1, err * 3 / 16)
      distributeError(cells, cellsX, cellsY, cx, cy + 1, err * 5 / 16)
      distributeError(cells, cellsX, cellsY, cx + 1, cy + 1, err * 1 / 16)
    }
  }
}

function distributeError(cells: CellSample[], cellsX: number, cellsY: number, x: number, y: number, err: number): void {
  if (x < 0 || y < 0 || x >= cellsX || y >= cellsY) return
  const cell = cells[y * cellsX + x]
  if (!cell) return
  cell.level = Math.max(0, Math.min(1, cell.level + err))
}

function renderCell(
  out: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  y0: number,
  style: CellStyle,
  level: number,
  color: [number, number, number],
): void {
  switch (style.type) {
    case 'font':
      renderFontCell(out, width, height, x0, y0, style, level, color)
      return
    case 'braille':
      renderBrailleCell(out, width, height, x0, y0, style, level, color)
      return
    case 'block':
    default:
      renderBlockCell(out, width, height, x0, y0, style, level, color)
  }
}

function renderFontCell(
  out: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  y0: number,
  style: Extract<CellStyle, { type: 'font' }>,
  level: number,
  color: [number, number, number],
): void {
  const index = Math.max(0, Math.min(style.chars.length - 1, Math.round(level * Math.max(0, style.chars.length - 1))))
  const ch = style.chars[index] ?? ' '
  const rows = ASCII_FONT.glyphs[ch.toUpperCase()] ?? ASCII_FONT.glyphs[' '] ?? ['00000']
  for (let yy = 0; yy < style.cellHeight; yy++) {
    const gy = Math.min(rows.length - 1, Math.floor((yy / style.cellHeight) * rows.length))
    const row = rows[gy] ?? '00000'
    for (let xx = 0; xx < style.cellWidth; xx++) {
      const gx = Math.min(row.length - 1, Math.floor((xx / style.cellWidth) * row.length))
      if (row[gx] !== '1') continue
      setPixel(out, width, height, x0 + xx, y0 + yy, color)
    }
  }
}

function renderBlockCell(
  out: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  y0: number,
  style: Extract<CellStyle, { type: 'block' }>,
  level: number,
  color: [number, number, number],
): void {
  const filledRows = Math.round(level * style.cellHeight)
  for (let yy = 0; yy < filledRows; yy++) {
    const py = y0 + style.cellHeight - 1 - yy
    for (let xx = 0; xx < style.cellWidth; xx++) setPixel(out, width, height, x0 + xx, py, color)
  }
}

function renderBrailleCell(
  out: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  y0: number,
  style: Extract<CellStyle, { type: 'braille' }>,
  level: number,
  color: [number, number, number],
): void {
  const dots = Math.round(level * 8)
  const order: [number, number][] = [
    [0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [0, 3], [1, 3],
  ]
  for (let i = 0; i < dots; i++) {
    const dot = order[i]
    if (!dot) continue
    const dx = dot[0] * Math.floor(style.cellWidth / 2)
    const dy = dot[1] * Math.floor(style.cellHeight / 4)
    fillRect(out, width, height, x0 + dx, y0 + dy, Math.max(1, Math.floor(style.cellWidth / 2)), Math.max(1, Math.floor(style.cellHeight / 4)), color)
  }
}

function quantizeColor(color: [number, number, number], mode: NonNullable<AnsiArtConfig['colorMode']>): [number, number, number] {
  switch (mode) {
    case 'mono': {
      const lum = Math.round(0.299 * color[0] + 0.587 * color[1] + 0.114 * color[2])
      return [lum, lum, lum]
    }
    case '256':
      return [quantizeAnsi(color[0]), quantizeAnsi(color[1]), quantizeAnsi(color[2])]
    case '24bit':
    default:
      return color
  }
}

function quantizeAnsi(value: number): number {
  const steps = [0, 95, 135, 175, 215, 255]
  let best = steps[0] ?? 0
  let bestDist = Infinity
  for (const step of steps) {
    const dist = Math.abs(step - value)
    if (dist < bestDist) {
      best = step
      bestDist = dist
    }
  }
  return best
}

function fillRect(
  out: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
  color: [number, number, number],
): void {
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) setPixel(out, width, height, x0 + xx, y0 + yy, color)
  }
}

function setPixel(
  out: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  color: [number, number, number],
): void {
  if (x < 0 || y < 0 || x >= width || y >= height) return
  const i = (y * width + x) * 4
  out[i] = color[0]
  out[i + 1] = color[1]
  out[i + 2] = color[2]
  out[i + 3] = 255
}

function uploadTexture(ctx: NodeContext, out: FrameBuffer): void {
  if (!ctx.gl || !out.texture) return
  const gl = ctx.gl
  gl.bindTexture(gl.TEXTURE_2D, out.texture)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, out.width, out.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, out.data)
}
