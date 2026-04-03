import type { FrameBuffer } from '@overscan/types'
import { sampleAsciiCell } from '../ascii-cell.js'

export function renderAscii(frame: FrameBuffer): string {
  const { width, height } = frame
  const rows: string[] = []

  for (let y = 0; y < height; y++) {
    let row = ''
    for (let x = 0; x < width; x++) {
      const { ch, r, g, b } = sampleAsciiCell(frame, x, y)
      row += `\x1b[38;2;${r};${g};${b}m${ch}`
    }
    row += '\x1b[0m'
    rows.push(row)
  }

  return rows.join('\n')
}
