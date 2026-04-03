import { describe, it, expect } from 'vitest'
import type { FrameBuffer } from '@overscan/types'
import { renderAscii } from './ascii.js'
import { renderAnsi } from './ansi.js'
import { renderSixel } from './sixel.js'

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '')
}

function makeFrame(w: number, h: number, rgb: [number, number, number]): FrameBuffer {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    data[i * 4 + 0] = rgb[0]
    data[i * 4 + 1] = rgb[1]
    data[i * 4 + 2] = rgb[2]
    data[i * 4 + 3] = 255
  }
  return {
    id:     't',
    width:  w,
    height: h,
    data,
    clear() {
      data.fill(0)
    },
  }
}

describe('terminal renderers', () => {
  it('ascii: one character cell per pixel', () => {
    const f = makeFrame(5, 4, [200, 200, 200])
    const out = renderAscii(f)
    const lines = out.split('\n')
    expect(lines.length).toBe(4)
    expect(lines.every(l => stripAnsi(l).length === 5)).toBe(true)
  })

  it('ascii: bright pixels map to dense characters', () => {
    const dark = stripAnsi(renderAscii(makeFrame(1, 1, [0, 0, 0])))
    const bright = stripAnsi(renderAscii(makeFrame(1, 1, [255, 255, 255])))
    expect(bright.charCodeAt(0) ?? 0).not.toBe(dark.charCodeAt(0) ?? 0)
  })

  it('ascii: truecolor foreground per cell', () => {
    const out = renderAscii(makeFrame(1, 1, [200, 40, 80]))
    expect(out).toContain('\x1b[38;2;200;40;80m')
    expect(out).toContain('\x1b[0m')
  })

  it('ansi: half-block packs two scanlines per row', () => {
    const f = makeFrame(6, 4, [10, 20, 30])
    const out = renderAnsi(f)
    expect(out.includes('▀')).toBe(true)
    expect(out.split('\n').length).toBe(2)
  })

  it('sixel: emits a DCS sixel introducer', () => {
    const f = makeFrame(4, 4, [90, 120, 200])
    const out = renderSixel(f)
    expect(out.startsWith('\x1bP')).toBe(true)
    expect(out.endsWith('\x1b\\') || out.includes('\x1b\\')).toBe(true)
  })
})
