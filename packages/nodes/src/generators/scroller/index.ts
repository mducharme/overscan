import { drawBitmapTextBlock, measureBitmapText, resolveBitmapFont } from '@overscan/text'
import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type Generator,
  type NodeContext,
  type FrameBuffer,
  type Signal,
} from '@overscan/types'
import { scaleFontSize, scaleThickness, VIEWPORT_REF_WIDTH } from '../../viewport-scale.js'

export interface ScrollerConfig {
  text?: string
  font?: string
  fontSize?: number
  speed?: AnimatableFloat
  initialScroll?: AnimatableFloat
  waveAmplitude?: AnimatableFloat
  waveFrequency?: AnimatableFloat
  waveSpeed?: AnimatableFloat
  color?: string
  backgroundColor?: string
  asciiFont?: boolean
  verticalPosition?: AnimatableFloat
  letterSpacing?: AnimatableFloat
  /**
   * 'sine' (default): every pixel column is offset by a standing wave, so letters bend as they pass.
   * 'dycp': each character moves as a block on its own sine height (Different Y Character Position).
   */
  mode?: 'sine' | 'dycp'
}

export function ScrollerGenerator(config: Partial<ScrollerConfig> = {}): Generator {
  const text = config.text ?? ' PHASE TWO · DEMOSCENE TOOLKIT '
  const fontSize = config.fontSize ?? 28
  const speedRef = config.speed ?? 40
  const initialScrollRef = config.initialScroll ?? 0
  const waveAmp = config.waveAmplitude ?? 4
  const waveFreq = config.waveFrequency ?? 0.08
  const waveSpeed = config.waveSpeed ?? 3
  const asciiFont = config.asciiFont ?? false
  const colorHex = config.color ?? '#ffe8b0'
  const backgroundHex = config.backgroundColor ?? 'transparent'
  const verticalPositionRef = config.verticalPosition ?? 0.5
  const letterSpacingRef = config.letterSpacing ?? 0
  const mode = config.mode ?? 'sine'
  let strip: { key: string; width: number; height: number; data: Uint8ClampedArray } | null = null

  return {
    type:       'generator',
    id:         'scroller',
    renderers:  ['cpu'],
    config:     config,
    init:       () => {},
    destroy:    () => {},
    render(_ctx: NodeContext, out: FrameBuffer, signal: Signal) {
      const { width: w, height: h, data } = out
      data.fill(0)

      const sp = resolveAnimatableFloat(speedRef, signal)
      const vel = Math.abs(sp) <= 1.5 ? 18 + sp * 72 : sp * 1.15
      const amp = scaleThickness(resolveAnimatableFloat(waveAmp, signal), w, h)
      const fq = resolveAnimatableFloat(waveFreq, signal)
      const ws = resolveAnimatableFloat(waveSpeed, signal)
      const vertical = Math.max(0, Math.min(1, resolveAnimatableFloat(verticalPositionRef, signal)))
      const letterSpacing = Math.round(resolveAnimatableFloat(letterSpacingRef, signal))
      const scale = Math.max(1, Math.round(scaleFontSize(fontSize, w, h) / 8))
      const font = resolveBitmapFont(config.font)
      const textWidth = measureBitmapText(text, { font, scale, letterSpacing }).width
      const initialScroll = resolveAnimatableFloat(initialScrollRef, signal)
      const pxPerSec = vel * 5 * (w / VIEWPORT_REF_WIDTH)
      const scroll = ((signal.t * pxPerSec) + initialScroll) % (w + textWidth)
      const color: [number, number, number] = asciiFont ? [255, 255, 255] : hexToRgb(colorHex)
      const background = backgroundHex === 'transparent' ? null : hexToRgb(backgroundHex)
      if (background) fillBackground(data, background)
      const baseY = Math.round((h - font.glyphHeight * scale) * vertical)

      const advance = font.glyphWidth * scale + font.spacingX * scale + letterSpacing
      const left = Math.round(w - scroll)
      if (mode === 'dycp') {
        for (let i = -1; i < text.length + 2; i++) {
          const ch = text[i] ?? ' '
          const x = left + i * advance
          const y = Math.round(baseY + Math.sin(i * fq + signal.t * ws) * amp)
          drawBitmapTextBlock(data, w, h, ch, x, y, { font, scale, color, letterSpacing })
        }
      } else {
        // Render the line once into a strip, then copy each column at its own wave height.
        const key = `${text}|${scale}|${letterSpacing}|${color.join(',')}|${config.font ?? ''}`
        if (strip?.key !== key) {
          const height = font.glyphHeight * scale
          const width = Math.max(1, textWidth)
          const stripData = new Uint8ClampedArray(width * height * 4)
          drawBitmapTextBlock(stripData, width, height, text, 0, 0, { font, scale, color, letterSpacing })
          strip = { key, width, height, data: stripData }
        }
        const src = strip.data
        // `waveFrequency` is radians per character; the wave stands still on screen while the text moves through it.
        const perColumn = fq / Math.max(1, advance)
        for (let x = Math.max(0, left); x < Math.min(w, left + strip.width); x++) {
          const sx = x - left
          const offset = Math.round(Math.sin(x * perColumn + signal.t * ws) * amp)
          for (let row = 0; row < strip.height; row++) {
            const si = (row * strip.width + sx) * 4
            if (src[si + 3] === 0) continue
            const y = baseY + row + offset
            if (y < 0 || y >= h) continue
            const o = (y * w + x) * 4
            data[o] = src[si]!
            data[o + 1] = src[si + 1]!
            data[o + 2] = src[si + 2]!
            data[o + 3] = 255
          }
        }
      }

      if (asciiFont) {
        for (let i = 0; i < data.length; i += 4) {
          const L = ((data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0)) / 3
          const v = L > 140 ? 255 : 0
          data[i]     = v
          data[i + 1] = v
          data[i + 2] = v
          data[i + 3] = 255
        }
      }
    },
  }
}

function fillBackground(data: Uint8ClampedArray, color: [number, number, number]): void {
  for (let i = 0; i < data.length; i += 4) {
    data[i] = color[0]
    data[i + 1] = color[1]
    data[i + 2] = color[2]
    data[i + 3] = 255
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const s = hex.replace('#', '')
  const n = parseInt(s.length === 3 ? s.split('').map(c => c + c).join('') : s, 16)
  return [
    Number.isFinite(n) ? (n >> 16) & 0xff : 255,
    Number.isFinite(n) ? (n >> 8) & 0xff : 255,
    Number.isFinite(n) ? n & 0xff : 255,
  ]
}
