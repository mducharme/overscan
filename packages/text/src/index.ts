export type BitmapTextAlign = 'left' | 'center' | 'right'

export interface BitmapFont {
  id: string
  glyphWidth: number
  glyphHeight: number
  spacingX: number
  spacingY: number
  glyphs: Record<string, string[]>
}

export interface BitmapTextStyle {
  font?: string | BitmapFont
  scale?: number
  color?: [number, number, number]
  letterSpacing?: number
  lineHeight?: number
  align?: BitmapTextAlign
}

export interface BitmapTextMetrics {
  width: number
  height: number
  lineWidths: number[]
  lineHeightPx: number
  scale: number
}

const EMPTY_GLYPH = ['00000', '00000', '00000', '00000', '00000', '00000', '00000']

const RAW_GLYPHS: Record<string, string[]> = {
  ' ': EMPTY_GLYPH,
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ',': ['00000', '00000', '00000', '00000', '01100', '01100', '01000'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  ';': ['00000', '01100', '01100', '00000', '01100', '01100', '01000'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  '?': ['01110', '10001', '00001', '00010', '00100', '00000', '00100'],
  '\'': ['00100', '00100', '00000', '00000', '00000', '00000', '00000'],
  '"': ['01010', '01010', '00000', '00000', '00000', '00000', '00000'],
  '-': ['00000', '00000', '00000', '11110', '00000', '00000', '00000'],
  '_': ['00000', '00000', '00000', '00000', '00000', '00000', '11111'],
  '=': ['00000', '11110', '00000', '11110', '00000', '00000', '00000'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
  '/': ['00001', '00010', '00100', '01000', '10000', '00000', '00000'],
  '\\': ['10000', '01000', '00100', '00010', '00001', '00000', '00000'],
  '|': ['00100', '00100', '00100', '00100', '00100', '00100', '00100'],
  '(': ['00010', '00100', '01000', '01000', '01000', '00100', '00010'],
  ')': ['01000', '00100', '00010', '00010', '00010', '00100', '01000'],
  '[': ['01110', '01000', '01000', '01000', '01000', '01000', '01110'],
  ']': ['01110', '00010', '00010', '00010', '00010', '00010', '01110'],
  '<': ['00001', '00010', '00100', '01000', '00100', '00010', '00001'],
  '>': ['10000', '01000', '00100', '00010', '00100', '01000', '10000'],
  '*': ['00000', '10101', '01110', '11111', '01110', '10101', '00000'],
  '#': ['01010', '11111', '01010', '01010', '11111', '01010', '00000'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '11100'],
  'A': ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  'B': ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  'C': ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  'D': ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  'E': ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  'F': ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  'G': ['01110', '10001', '10000', '10111', '10001', '10001', '01110'],
  'H': ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  'I': ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  'J': ['00001', '00001', '00001', '00001', '10001', '10001', '01110'],
  'K': ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  'L': ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  'M': ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  'N': ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  'O': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  'P': ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  'Q': ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  'R': ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  'S': ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  'T': ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  'U': ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  'V': ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  'W': ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  'X': ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  'Y': ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  'Z': ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
}

export const Tiny5x7Font: BitmapFont = {
  id: 'overscan://fonts/Tiny5x7',
  glyphWidth: 5,
  glyphHeight: 7,
  spacingX: 1,
  spacingY: 1,
  glyphs: RAW_GLYPHS,
}

export const ShareTechMonoFont: BitmapFont = {
  ...Tiny5x7Font,
  id: 'overscan://fonts/ShareTechMono',
}

export const PressStart2PFont: BitmapFont = {
  ...Tiny5x7Font,
  id: 'overscan://fonts/Press2P',
  spacingX: 2,
}

export function resolveBitmapFont(font?: string | BitmapFont): BitmapFont {
  if (!font) return ShareTechMonoFont
  if (typeof font !== 'string') return font
  switch (font) {
    case 'tiny5x7':
    case 'default':
    case 'overscan://fonts/Tiny5x7':
      return Tiny5x7Font
    case 'press2p':
    case 'overscan://fonts/Press2P':
      return PressStart2PFont
    case 'share-tech-mono':
    case 'overscan://fonts/ShareTechMono':
    default:
      return ShareTechMonoFont
  }
}

function glyphRows(font: BitmapFont, ch: string): string[] {
  const key = ch === '·' ? '.' : ch.toUpperCase()
  return font.glyphs[key] ?? EMPTY_GLYPH
}

function normalizeScale(scale?: number): number {
  return Math.max(1, Math.round(scale ?? 1))
}

function measureLine(text: string, font: BitmapFont, scale: number, letterSpacing: number): number {
  if (text.length === 0) return 0
  const advance = font.glyphWidth * scale + font.spacingX * scale + letterSpacing
  return text.length * advance - (font.spacingX * scale + letterSpacing)
}

export function measureBitmapText(text: string, style: BitmapTextStyle = {}): BitmapTextMetrics {
  const font = resolveBitmapFont(style.font)
  const scale = normalizeScale(style.scale)
  const letterSpacing = Math.max(0, Math.round(style.letterSpacing ?? 0))
  const lineAdvance = Math.max(
    font.glyphHeight * scale,
    Math.round(font.glyphHeight * scale * Math.max(1, style.lineHeight ?? 1)),
  )
  const lines = text.split('\n')
  const lineWidths = lines.map(line => measureLine(line, font, scale, letterSpacing))
  return {
    width: lineWidths.reduce((max, width) => Math.max(max, width), 0),
    height: lines.length === 0 ? 0 : font.glyphHeight * scale + Math.max(0, lines.length - 1) * lineAdvance,
    lineWidths,
    lineHeightPx: lineAdvance,
    scale,
  }
}

export function bitmapTextWidth(text: string, scale: number): number {
  return measureBitmapText(text, { scale }).width
}

export function drawBitmapTextBlock(
  out: Uint8ClampedArray,
  width: number,
  height: number,
  text: string,
  x0: number,
  y0: number,
  style: BitmapTextStyle = {},
): void {
  const font = resolveBitmapFont(style.font)
  const scale = normalizeScale(style.scale)
  const color = style.color ?? [255, 255, 255]
  const letterSpacing = Math.max(0, Math.round(style.letterSpacing ?? 0))
  const align = style.align ?? 'left'
  const metrics = measureBitmapText(text, { ...style, font, scale, letterSpacing })
  const lines = text.split('\n')
  const advance = font.glyphWidth * scale + font.spacingX * scale + letterSpacing

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex] ?? ''
    const lineWidth = metrics.lineWidths[lineIndex] ?? 0
    const lineX = align === 'center'
      ? Math.round(x0 - lineWidth / 2)
      : align === 'right'
        ? Math.round(x0 - lineWidth)
        : Math.round(x0)
    const lineY = Math.round(y0 + lineIndex * metrics.lineHeightPx)

    for (let i = 0; i < line.length; i++) {
      const rows = glyphRows(font, line[i] ?? ' ')
      const gx = lineX + i * advance
      for (let y = 0; y < rows.length; y++) {
        const row = rows[y] ?? '00000'
        for (let x = 0; x < row.length; x++) {
          if (row[x] !== '1') continue
          for (let sy = 0; sy < scale; sy++) {
            const py = lineY + y * scale + sy
            if (py < 0 || py >= height) continue
            for (let sx = 0; sx < scale; sx++) {
              const px = gx + x * scale + sx
              if (px < 0 || px >= width) continue
              const o = (py * width + px) * 4
              out[o] = color[0]
              out[o + 1] = color[1]
              out[o + 2] = color[2]
              out[o + 3] = 255
            }
          }
        }
      }
    }
  }
}

export function drawBitmapText(
  out: Uint8ClampedArray,
  width: number,
  height: number,
  text: string,
  x0: number,
  y0: number,
  scale: number,
  color: [number, number, number],
): void {
  drawBitmapTextBlock(out, width, height, text, x0, y0, { scale, color })
}
