import type { FrameBuffer } from '@overscan/types'
import { sampleAnsiHalfBlockPixels } from '../ansi-half-block.js'

// ANSI block mode — ▀ half-block, 2 vertical pixels per character cell.
// Top pixel → foreground, bottom pixel → background.
export function renderAnsi(frame: FrameBuffer): string {
  const { width, height } = frame
  const rows: string[] = []

  for (let y = 0; y < height; y += 2) {
    let row = ''
    for (let x = 0; x < width; x++) {
      const { tr, tg, tb, br, bg, bb } = sampleAnsiHalfBlockPixels(frame, x, y)

      // fg = top pixel, bg = bottom pixel
      row += `\x1b[38;2;${tr};${tg};${tb}m\x1b[48;2;${br};${bg};${bb}m▀`
    }
    row += '\x1b[0m'  // reset at end of row
    rows.push(row)
  }

  return rows.join('\n')
}
