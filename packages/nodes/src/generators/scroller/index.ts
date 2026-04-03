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

  return {
    type:       'generator',
    id:         'scroller',
    renderers:  ['cpu'],
    config:     config as Generator['config'],
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

      for (let i = -1; i < text.length + 2; i++) {
        const ch = text[i] ?? ' '
        const advance = font.glyphWidth * scale + font.spacingX * scale + letterSpacing
        const x = Math.round(w - scroll + i * advance)
        const y = Math.round(baseY + Math.sin(i * fq + signal.t * ws) * amp)
        drawBitmapTextBlock(data, w, h, ch, x, y, {
          font,
          scale,
          color,
          letterSpacing,
        })
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
