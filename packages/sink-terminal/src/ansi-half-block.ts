import type { FrameBuffer } from '@overscan/types'

/** Sample top/bottom RGB for one half-block (▀) cell: column `x`, top pixel row `y` (must be even). */
export function sampleAnsiHalfBlockPixels(
  frame: FrameBuffer,
  x: number,
  y: number,
): { tr: number; tg: number; tb: number; br: number; bg: number; bb: number } {
  const { width, height, data } = frame
  const topOff = (y * width + x) * 4
  const botOff = ((y + 1) * width + x) * 4

  const tr = data[topOff] ?? 0
  const tg = data[topOff + 1] ?? 0
  const tb = data[topOff + 2] ?? 0

  const br = y + 1 < height ? (data[botOff] ?? 0) : 0
  const bg = y + 1 < height ? (data[botOff + 1] ?? 0) : 0
  const bb = y + 1 < height ? (data[botOff + 2] ?? 0) : 0

  return { tr, tg, tb, br, bg, bb }
}
