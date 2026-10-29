import type { FrameBuffer } from '@overscan/types'
import { sampleAnsiHalfBlockPixels } from './ansi-half-block.js'
import { sampleAsciiCell } from './ascii-cell.js'

/** Begin/end synchronized update (DEC mode 2026): the terminal shows the frame at once, no tearing. Ignored where unsupported. */
const SYNC_BEGIN = '\x1b[?2026h'
const SYNC_END = '\x1b[?2026l'
const HALF_BLOCK = '▀'
/** A colour within this many levels per channel of what the terminal shows is not resent (invisible, saves bytes). */
const COLOR_TOLERANCE = 3

function near(a: number, b: number): boolean {
  return Math.abs((a >>> 16) - (b >>> 16)) <= COLOR_TOLERANCE
    && Math.abs(((a >>> 8) & 0xff) - ((b >>> 8) & 0xff)) <= COLOR_TOLERANCE
    && Math.abs((a & 0xff) - (b & 0xff)) <= COLOR_TOLERANCE
}

/**
 * Incremental encoder for live ANSI (half-block) and ASCII terminal output. It remembers the cells it
 * last sent and emits only the cells that changed, moving the cursor over unchanged runs and sending a
 * colour code only when the colour differs from the current one. Cells whose colours moved by at most
 * COLOR_TOLERANCE levels are left as they are on screen. A static or slowly changing picture
 * costs a fraction of a full redraw, which keeps playback from stalling on terminal throughput.
 */
export class TerminalFrameEncoder {
  /** Per cell: [foreground RGB, background RGB or glyph code]. */
  private prev: Uint32Array | null = null
  private cols = 0
  private rows = 0

  /** Forget what the terminal shows (after a resize or clear): the next frame is drawn in full. */
  reset(): void {
    this.prev = null
  }

  /** Bytes that bring the terminal from the last frame to this one; '' when nothing changed. */
  encode(mode: 'ansi' | 'ascii', frame: FrameBuffer): string {
    const cols = frame.width
    const rows = mode === 'ansi' ? Math.ceil(frame.height / 2) : frame.height
    if (!this.prev || cols !== this.cols || rows !== this.rows) {
      this.prev = null
      this.cols = cols
      this.rows = rows
    }
    const prev = this.prev
    const next = new Uint32Array(cols * rows * 2)
    const parts: string[] = []
    let penFg = -1
    let penBg = -1
    let cursorRow = -1
    let cursorCol = -1

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const cell = (row * cols + col) * 2
        let fg: number
        let second: number
        let glyph: string
        if (mode === 'ansi') {
          const p = sampleAnsiHalfBlockPixels(frame, col, row * 2)
          fg = (p.tr << 16) | (p.tg << 8) | p.tb
          second = (p.br << 16) | (p.bg << 8) | p.bb
          glyph = HALF_BLOCK
        } else {
          const c = sampleAsciiCell(frame, col, row)
          fg = (c.r << 16) | (c.g << 8) | c.b
          glyph = c.ch
          second = glyph.charCodeAt(0)
        }
        if (prev && near(prev[cell]!, fg) && (mode === 'ansi' ? near(prev[cell + 1]!, second) : prev[cell + 1] === second)) {
          // Unchanged on screen: keep remembering what the terminal actually shows.
          next[cell] = prev[cell]!
          next[cell + 1] = prev[cell + 1]!
          continue
        }
        next[cell] = fg
        next[cell + 1] = second

        if (cursorRow !== row || cursorCol !== col) parts.push(`\x1b[${row + 1};${col + 1}H`)
        if (fg !== penFg) {
          parts.push(`\x1b[38;2;${fg >>> 16};${(fg >>> 8) & 0xff};${fg & 0xff}m`)
          penFg = fg
        }
        if (mode === 'ansi' && second !== penBg) {
          parts.push(`\x1b[48;2;${second >>> 16};${(second >>> 8) & 0xff};${second & 0xff}m`)
          penBg = second
        }
        parts.push(glyph)
        cursorRow = row
        cursorCol = col + 1
      }
    }

    this.prev = next
    if (parts.length === 0) return ''
    return `${SYNC_BEGIN}${parts.join('')}\x1b[0m${SYNC_END}`
  }
}
