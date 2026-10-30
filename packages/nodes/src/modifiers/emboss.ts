import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Modifier,
  type NodeContext,
  type Signal,
} from '@overscan/types'

export interface EmbossConfig {
  angle?: AnimatableFloat
  strength?: AnimatableFloat
  color?: boolean
}

export function EmbossModifier(config: Partial<EmbossConfig> = {}): Modifier {
  const angleRef = config.angle ?? 45
  const strengthRef = config.strength ?? 1
  const preserveColor = config.color ?? false

  return {
    type: 'modifier',
    id: 'emboss',
    persistent: false,
    config: config,
    init() {},
    destroy() {},
    apply(ctx: NodeContext, input: FrameBuffer, out: FrameBuffer, signal: Signal): void {
      const angleDeg = resolveAnimatableFloat(angleRef, signal)
      const strength = Math.max(0, resolveAnimatableFloat(strengthRef, signal))
      const radians = angleDeg * Math.PI / 180
      const dx = Math.round(Math.cos(radians))
      const dy = Math.round(Math.sin(radians))
      const { width: w, height: h, data: src } = input
      const dst = out.data

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4
          const hi = sampleLuma(src, w, h, x + dx, y + dy)
          const lo = sampleLuma(src, w, h, x - dx, y - dy)
          const shade = Math.max(0, Math.min(255, Math.round(128 + (hi - lo) * strength)))

          if (preserveColor) {
            const r = src[i] ?? 0
            const g = src[i + 1] ?? 0
            const b = src[i + 2] ?? 0
            const lum = (0.299 * r + 0.587 * g + 0.114 * b) || 1
            const factor = shade / lum
            dst[i] = clampByte(r * factor)
            dst[i + 1] = clampByte(g * factor)
            dst[i + 2] = clampByte(b * factor)
          } else {
            dst[i] = shade
            dst[i + 1] = shade
            dst[i + 2] = shade
          }
          dst[i + 3] = src[i + 3] ?? 255
        }
      }

      uploadTexture(ctx, out)
    },
  }
}

function sampleLuma(data: Uint8ClampedArray, w: number, h: number, x: number, y: number): number {
  const sx = Math.max(0, Math.min(w - 1, x))
  const sy = Math.max(0, Math.min(h - 1, y))
  const i = (sy * w + sx) * 4
  const r = data[i] ?? 0
  const g = data[i + 1] ?? 0
  const b = data[i + 2] ?? 0
  return 0.299 * r + 0.587 * g + 0.114 * b
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function uploadTexture(ctx: NodeContext, out: FrameBuffer): void {
  if (!ctx.gl || !out.texture) return
  const gl = ctx.gl
  gl.bindTexture(gl.TEXTURE_2D, out.texture)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, out.width, out.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, out.data)
}
