import { drawBitmapTextBlock, measureBitmapText, resolveBitmapFont } from '@overscan/text'
import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Generator,
  type NodeContext,
  type Signal,
} from '@overscan/types'
import { scaleFontSize } from '../../viewport-scale.js'

export interface TextConfig {
  text?: string
  font?: string
  fontSize?: number
  color?: string
  backgroundColor?: string
  align?: 'left' | 'center' | 'right'
  letterSpacing?: AnimatableFloat
  lineHeight?: AnimatableFloat
  x?: AnimatableFloat
  y?: AnimatableFloat
}

export function TextGenerator(config: Partial<TextConfig> = {}): Generator {
  const text = config.text ?? 'OVERSCAN'
  const fontName = config.font ?? 'overscan://fonts/ShareTechMono'
  const fontSize = config.fontSize ?? 24
  const colorHex = config.color ?? '#ffffff'
  const backgroundHex = config.backgroundColor ?? 'transparent'
  const align = config.align ?? 'center'
  const xRef = config.x ?? 0.5
  const yRef = config.y ?? 0.5
  const letterSpacingRef = config.letterSpacing ?? 0
  const lineHeightRef = config.lineHeight ?? 1.15

  return {
    type: 'generator',
    id: 'text',
    renderers: ['cpu'],
    config: config as Generator['config'],
    init: () => {},
    destroy: () => {},
    render(_ctx: NodeContext, out: FrameBuffer, signal: Signal) {
      const { width, height, data } = out
      if (backgroundHex === 'transparent') data.fill(0)
      else fillBackground(data, hexToRgb(backgroundHex))

      const scale = Math.max(1, Math.round(scaleFontSize(fontSize, width, height) / 8))
      const letterSpacing = Math.round(resolveAnimatableFloat(letterSpacingRef, signal))
      const lineHeight = Math.max(1, resolveAnimatableFloat(lineHeightRef, signal))
      const color = hexToRgb(colorHex)
      const font = resolveBitmapFont(fontName)
      const metrics = measureBitmapText(text, {
        font,
        scale,
        letterSpacing,
        lineHeight,
        align,
      })
      const xNorm = Math.max(0, Math.min(1, resolveAnimatableFloat(xRef, signal)))
      const yNorm = Math.max(0, Math.min(1, resolveAnimatableFloat(yRef, signal)))
      const anchorX = Math.round(width * xNorm)
      const anchorY = Math.round(height * yNorm - metrics.height / 2)
      drawBitmapTextBlock(data, width, height, text, anchorX, anchorY, {
        font,
        scale,
        color,
        letterSpacing,
        lineHeight,
        align,
      })
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
