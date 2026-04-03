import { createCanvas, registerFont } from 'canvas'
import type { FrameBuffer, TerminalMode } from '@overscan/types'
import { sampleAnsiHalfBlockPixels, sampleAsciiCell } from '@overscan/sink-terminal'

export interface TerminalRasterizeOptions {
  mode: TerminalMode
  cellWidth: number
  cellHeight: number
  /** Integer scale from framebuffer pixel to output pixel in sixel mode (default 2). */
  sixelPixelScale?: number
  /** Optional TTF/OTF for ASCII mode (registered as family `overscan-export-mono`). */
  asciiFontPath?: string
  /** CSS font family when `asciiFontPath` is not set (default `monospace`). */
  asciiFontFamily?: string
}

export function terminalRasterOutputDimensions(
  mode: TerminalMode,
  frameWidth: number,
  frameHeight: number,
  cellWidth: number,
  cellHeight: number,
  sixelPixelScale = 2,
): { width: number; height: number } {
  switch (mode) {
    case 'ansi': {
      const charRows = Math.ceil(frameHeight / 2)
      return { width: frameWidth * cellWidth, height: charRows * cellHeight }
    }
    case 'ascii':
      return { width: frameWidth * cellWidth, height: frameHeight * cellHeight }
    case 'sixel': {
      const s = Math.max(1, Math.floor(sixelPixelScale))
      return { width: frameWidth * s, height: frameHeight * s }
    }
  }
}

/**
 * Rasterize a terminal-sized framebuffer to RGBA (same layout as {@link FrameBuffer}).
 */
export function rasterizeTerminalFrameToRgba(
  frame: FrameBuffer,
  opts: TerminalRasterizeOptions,
): { width: number; height: number; data: Uint8ClampedArray } {
  const cw = opts.cellWidth
  const ch = opts.cellHeight
  const scale = opts.sixelPixelScale ?? 2
  const { width: rw, height: rh } = terminalRasterOutputDimensions(
    opts.mode,
    frame.width,
    frame.height,
    cw,
    ch,
    scale,
  )

  const canvas = createCanvas(rw, rh)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('terminal raster: failed to get 2d context')

  ctx.imageSmoothingEnabled = false

  switch (opts.mode) {
    case 'ansi': {
      for (let y = 0; y < frame.height; y += 2) {
        const charRow = y / 2
        for (let x = 0; x < frame.width; x++) {
          const { tr, tg, tb, br, bg, bb } = sampleAnsiHalfBlockPixels(frame, x, y)
          const px = x * cw
          const py = charRow * ch
          const topH = Math.floor(ch / 2)
          const botH = ch - topH
          ctx.fillStyle = `rgb(${tr},${tg},${tb})`
          ctx.fillRect(px, py, cw, topH)
          ctx.fillStyle = `rgb(${br},${bg},${bb})`
          ctx.fillRect(px, py + topH, cw, botH)
        }
      }
      break
    }
    case 'ascii': {
      const fam = opts.asciiFontFamily ?? 'monospace'
      if (opts.asciiFontPath) {
        try {
          registerFont(opts.asciiFontPath, { family: 'overscan-export-mono', weight: 'normal' })
          ctx.font = `${ch}px overscan-export-mono`
        } catch {
          ctx.font = `${ch}px ${fam}`
        }
      } else {
        ctx.font = `${ch}px ${fam}`
      }
      ctx.textBaseline = 'top'
      for (let y = 0; y < frame.height; y++) {
        for (let x = 0; x < frame.width; x++) {
          const { ch: glyph, r, g, b } = sampleAsciiCell(frame, x, y)
          ctx.fillStyle = `rgb(${r},${g},${b})`
          ctx.fillText(glyph, x * cw, y * ch)
        }
      }
      break
    }
    case 'sixel': {
      const tmp = createCanvas(frame.width, frame.height)
      const tctx = tmp.getContext('2d')
      if (!tctx) throw new Error('terminal raster sixel: temp 2d context failed')
      const id = tctx.createImageData(frame.width, frame.height)
      const need = frame.width * frame.height * 4
      id.data.set(frame.data.subarray(0, need))
      tctx.putImageData(id, 0, 0)
      ctx.drawImage(tmp, 0, 0, rw, rh)
      break
    }
  }

  const imageData = ctx.getImageData(0, 0, rw, rh)
  return { width: rw, height: rh, data: imageData.data }
}
