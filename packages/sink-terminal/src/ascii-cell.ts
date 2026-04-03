import type { FrameBuffer } from '@overscan/types'

// Luminance-ordered ASCII palette — dense to sparse (must match renderers/ascii.ts)
const PALETTE = '$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,"^`. '
const LEN = PALETTE.length

/** Glyph and truecolor for one ASCII terminal cell. */
export function sampleAsciiCell(
  frame: FrameBuffer,
  x: number,
  y: number,
): { ch: string; r: number; g: number; b: number } {
  const { width, height, data } = frame
  const off = (y * width + x) * 4
  const r = data[off] ?? 0
  const g = data[off + 1] ?? 0
  const b = data[off + 2] ?? 0
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  const idx = Math.min(Math.floor(lum * LEN), LEN - 1)
  const ch = PALETTE[LEN - 1 - idx] ?? ' '
  return { ch, r, g, b }
}
