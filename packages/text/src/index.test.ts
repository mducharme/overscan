import { describe, expect, it } from 'vitest'
import { bitmapTextWidth, measureBitmapText, resolveBitmapFont } from './index.js'

describe('@overscan/text', () => {
  it('measures multiline text with spacing and scale', () => {
    const metrics = measureBitmapText('AB\nC', {
      scale: 2,
      letterSpacing: 1,
      lineHeight: 1.5,
    })

    expect(metrics.width).toBeGreaterThan(0)
    expect(metrics.height).toBeGreaterThan(14)
    expect(metrics.lineWidths[0]).toBeGreaterThan(metrics.lineWidths[1] ?? 0)
  })

  it('supports built-in font aliases', () => {
    expect(resolveBitmapFont('overscan://fonts/ShareTechMono').id).toBe('overscan://fonts/ShareTechMono')
    expect(resolveBitmapFont('overscan://fonts/Press2P').id).toBe('overscan://fonts/Press2P')
  })

  it('keeps bitmapTextWidth compatibility for single-line text', () => {
    expect(bitmapTextWidth('ABC', 2)).toBe(measureBitmapText('ABC', { scale: 2 }).width)
  })
})
