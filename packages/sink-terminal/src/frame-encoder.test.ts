import { describe, expect, it } from 'vitest'
import type { FrameBuffer } from '@overscan/types'
import { TerminalFrameEncoder } from './frame-encoder.js'
import { sampleAnsiHalfBlockPixels } from './ansi-half-block.js'

function frame(width: number, height: number, fill: (x: number, y: number) => [number, number, number]): FrameBuffer {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = fill(x, y)
      data.set([r, g, b, 255], (y * width + x) * 4)
    }
  }
  return { id: 'f', width, height, data, clear() { data.fill(0) } }
}

interface Cell { fg: number; bg: number; ch: string }

/** Minimal terminal: cursor positioning, 24-bit SGR colours and printable glyphs. */
class MiniTerminal {
  readonly cells: Cell[]
  private row = 0
  private col = 0
  private fg = 0
  private bg = 0

  constructor(readonly cols: number, readonly rows: number) {
    this.cells = Array.from({ length: cols * rows }, () => ({ fg: -1, bg: -1, ch: ' ' }))
  }

  feed(bytes: string): void {
    const re = /\x1b\[([?\d;]*)([A-Za-z])|([^\x1b])/gu
    for (const m of bytes.matchAll(re)) {
      if (m[3] !== undefined) {
        this.cells[this.row * this.cols + this.col] = { fg: this.fg, bg: this.bg, ch: m[3] }
        this.col++
        continue
      }
      const params = m[1] ?? ''
      if (m[2] === 'H') {
        const [r, c] = params.split(';').map(Number)
        this.row = (r ?? 1) - 1
        this.col = (c ?? 1) - 1
      } else if (m[2] === 'm' && params.startsWith('38;2;')) {
        const [, , r, g, b] = params.split(';').map(Number)
        this.fg = (r! << 16) | (g! << 8) | b!
      } else if (m[2] === 'm' && params.startsWith('48;2;')) {
        const [, , r, g, b] = params.split(';').map(Number)
        this.bg = (r! << 16) | (g! << 8) | b!
      }
    }
  }
}

const close = (a: number, b: number): boolean =>
  Math.abs((a >> 16) - (b >> 16)) <= 3 && Math.abs(((a >> 8) & 255) - ((b >> 8) & 255)) <= 3 && Math.abs((a & 255) - (b & 255)) <= 3

describe('TerminalFrameEncoder', () => {
  it('reproduces every frame of a sequence on the terminal while sending only changes', () => {
    const W = 24
    const H = 12
    const term = new MiniTerminal(W, H / 2)
    const enc = new TerminalFrameEncoder()
    const sizes: number[] = []
    for (let f = 0; f < 6; f++) {
      const fr = frame(W, H, (x, y) => (x < 4 + f * 3 && y < 6 ? [255, 40 * f, 0] : [(x * 10) % 256, y * 20, 90]))
      const out = enc.encode('ansi', fr)
      sizes.push(out.length)
      term.feed(out)
      for (let row = 0; row < H / 2; row++) {
        for (let col = 0; col < W; col++) {
          const p = sampleAnsiHalfBlockPixels(fr, col, row * 2)
          const cell = term.cells[row * W + col]!
          expect(close(cell.fg, (p.tr << 16) | (p.tg << 8) | p.tb)).toBe(true)
          expect(close(cell.bg, (p.br << 16) | (p.bg << 8) | p.bb)).toBe(true)
          expect(cell.ch).toBe('▀')
        }
      }
    }
    // The first frame is drawn in full; later frames only touch the moving block.
    expect(sizes.slice(1).every(n => n < sizes[0]! / 2)).toBe(true)
  })

  it('sends nothing for an unchanged frame, or for changes within the colour tolerance', () => {
    const enc = new TerminalFrameEncoder()
    enc.encode('ansi', frame(8, 4, () => [100, 100, 100]))
    expect(enc.encode('ansi', frame(8, 4, () => [100, 100, 100]))).toBe('')
    expect(enc.encode('ansi', frame(8, 4, () => [102, 98, 101]))).toBe('')
    expect(enc.encode('ansi', frame(8, 4, () => [110, 100, 100]))).not.toBe('')
  })

  it('redraws in full after reset or a size change', () => {
    const enc = new TerminalFrameEncoder()
    const a = enc.encode('ascii', frame(8, 4, () => [200, 200, 200]))
    enc.reset()
    expect(enc.encode('ascii', frame(8, 4, () => [200, 200, 200]))).toBe(a)
    expect(enc.encode('ascii', frame(10, 4, () => [200, 200, 200])).length).toBeGreaterThan(a.length)
  })
})
