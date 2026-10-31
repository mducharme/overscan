import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Generator,
  type LoadedImageAsset,
  type NodeContext,
  type Signal,
} from '@overscan/types'
import { drawBitmapTextBlock, measureBitmapText } from '@overscan/text'
import { fillRgb, hexToRgb, readPalette, samplePalette, type Rgb } from '../../color.js'

export interface ImageConfig {
  /** Picture to show (png, jpg, …, or a built-in `overscan://` image). */
  imageUrl?: string
  /** Without an image: a logo drawn from this text in a bitmap font, filled with `palette` top to bottom. */
  text?: string
  font?: string
  palette?: number[][]
  /** Dark outline around the logo's letters, in logo pixels (0 for none). */
  outline?: number
  /** How the picture fills the frame before `scale`. */
  fit?: 'contain' | 'cover' | 'stretch'
  scale?: AnimatableFloat
  /** Centre position, 0–1 of the frame. */
  x?: AnimatableFloat
  y?: AnimatableFloat
  opacity?: AnimatableFloat
  backgroundColor?: string
  /** Smooth (bilinear) scaling; off keeps hard pixel edges. */
  smooth?: boolean
}

const LOGO_PALETTE: Rgb[] = [[255, 248, 196], [255, 176, 64], [232, 72, 120], [120, 56, 200]]

/** A text logo as an RGBA image: gradient-filled letters with an optional dark outline, transparent elsewhere. */
export function renderLogo(text: string, font: string, palette: readonly Rgb[], outline: number): LoadedImageAsset {
  const pad = Math.max(0, Math.round(outline))
  const metrics = measureBitmapText(text, { font, scale: 1 })
  const width = Math.max(1, metrics.width + pad * 2)
  const height = Math.max(1, metrics.height + pad * 2)
  const mask = new Uint8ClampedArray(width * height * 4)
  drawBitmapTextBlock(mask, width, height, text, pad, pad, { font, scale: 1, color: [255, 255, 255] })
  const data = new Uint8ClampedArray(width * height * 4)
  const color: Rgb = [0, 0, 0]
  for (let y = 0; y < height; y++) {
    samplePalette(palette, height > 1 ? (y - pad) / Math.max(1, metrics.height - 1) : 0, color)
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      if (mask[o + 3]) {
        data[o] = color[0]; data[o + 1] = color[1]; data[o + 2] = color[2]; data[o + 3] = 255
        continue
      }
      if (!pad) continue
      // Outline: any letter pixel within `pad` makes this one dark.
      let near = false
      for (let dy = -pad; dy <= pad && !near; dy++) {
        for (let dx = -pad; dx <= pad && !near; dx++) {
          const sx = x + dx
          const sy = y + dy
          if (sx >= 0 && sy >= 0 && sx < width && sy < height && mask[(sy * width + sx) * 4 + 3]) near = true
        }
      }
      if (near) { data[o] = 8; data[o + 1] = 6; data[o + 2] = 20; data[o + 3] = 255 }
    }
  }
  return { width, height, data }
}

/**
 * Shows a picture or a text logo, scaled to fit and placed anywhere in the frame. The source for
 * logos, fades, bump mapping and wobbles; transparent around the picture so it composites cleanly.
 */
export function ImageGenerator(config: Partial<ImageConfig> = {}): Generator {
  const palette = readPalette(config.palette, LOGO_PALETTE)
  const background = config.backgroundColor && config.backgroundColor !== 'transparent' ? hexToRgb(config.backgroundColor, [0, 0, 0]) : null
  const fit = config.fit ?? 'contain'
  const scaleRef = config.scale ?? 0.8
  const xRef = config.x ?? 0.5
  const yRef = config.y ?? 0.5
  const opacityRef = config.opacity ?? 1
  const smooth = config.smooth ?? false
  let logo: LoadedImageAsset | null = null

  const source = (ctx: NodeContext): LoadedImageAsset | null => {
    if (config.imageUrl) return ctx.assets?.getImage(config.imageUrl) ?? null
    logo ??= renderLogo(config.text ?? 'OVERSCAN', config.font ?? 'overscan://fonts/Tiny5x7', palette, config.outline ?? 1)
    return logo
  }

  return {
    type: 'generator',
    id: 'image',
    renderers: ['cpu'],
    config: config,
    init() {},
    render(ctx: NodeContext, out: FrameBuffer, signal: Signal): void {
      const { width: w, height: h, data } = out
      if (background) fillRgb(data, background)
      else data.fill(0)
      const img = source(ctx)
      if (!img) return
      const fitScale = fit === 'cover' ? Math.max(w / img.width, h / img.height) : Math.min(w / img.width, h / img.height)
      const k = Math.max(1e-4, resolveAnimatableFloat(scaleRef, signal))
      const sx = (fit === 'stretch' ? w / img.width : fitScale) * k
      const sy = (fit === 'stretch' ? h / img.height : fitScale) * k
      const cx = resolveAnimatableFloat(xRef, signal) * w
      const cy = resolveAnimatableFloat(yRef, signal) * h
      const opacity = Math.max(0, Math.min(1, resolveAnimatableFloat(opacityRef, signal)))
      if (opacity <= 0) return
      const left = cx - (img.width * sx) / 2
      const top = cy - (img.height * sy) / 2
      const x0 = Math.max(0, Math.floor(left))
      const x1 = Math.min(w, Math.ceil(left + img.width * sx))
      const y0 = Math.max(0, Math.floor(top))
      const y1 = Math.min(h, Math.ceil(top + img.height * sy))
      const src = img.data
      for (let y = y0; y < y1; y++) {
        const v = (y + 0.5 - top) / sy - (smooth ? 0.5 : 0)
        for (let x = x0; x < x1; x++) {
          const u = (x + 0.5 - left) / sx - (smooth ? 0.5 : 0)
          let r: number, g: number, b: number, a: number
          if (smooth) {
            const ux = Math.max(0, Math.min(img.width - 1, u))
            const vy = Math.max(0, Math.min(img.height - 1, v))
            const ix = Math.floor(ux), iy = Math.floor(vy)
            const jx = Math.min(img.width - 1, ix + 1), jy = Math.min(img.height - 1, iy + 1)
            const fx = ux - ix, fy = vy - iy
            const p00 = (iy * img.width + ix) * 4, p10 = (iy * img.width + jx) * 4
            const p01 = (jy * img.width + ix) * 4, p11 = (jy * img.width + jx) * 4
            const lerp2 = (c: number): number => {
              const t0 = src[p00 + c]! + (src[p10 + c]! - src[p00 + c]!) * fx
              const t1 = src[p01 + c]! + (src[p11 + c]! - src[p01 + c]!) * fx
              return t0 + (t1 - t0) * fy
            }
            r = lerp2(0); g = lerp2(1); b = lerp2(2); a = lerp2(3)
          } else {
            const ix = Math.floor(u), iy = Math.floor(v)
            if (ix < 0 || iy < 0 || ix >= img.width || iy >= img.height) continue
            const p = (iy * img.width + ix) * 4
            r = src[p]!; g = src[p + 1]!; b = src[p + 2]!; a = src[p + 3]!
          }
          const alpha = (a / 255) * opacity
          if (alpha <= 0) continue
          const o = (y * w + x) * 4
          if (background || data[o + 3]! > 0) {
            data[o] = data[o]! + (r - data[o]!) * alpha
            data[o + 1] = data[o + 1]! + (g - data[o + 1]!) * alpha
            data[o + 2] = data[o + 2]! + (b - data[o + 2]!) * alpha
            data[o + 3] = 255
          } else {
            // Transparent background: keep colour and alpha separate so compositors blend the edge.
            data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = alpha * 255
          }
        }
      }
    },
    destroy() { logo = null },
  }
}
