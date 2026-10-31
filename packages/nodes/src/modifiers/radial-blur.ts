import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Modifier,
  type NodeContext,
  type Signal,
} from '@overscan/types'

export interface RadialBlurConfig {
  /** Centre of the streaks, 0–1 of the frame. */
  centerX?: AnimatableFloat
  centerY?: AnimatableFloat
  /** Streak length as a fraction of the distance to the centre (0–1). */
  strength?: AnimatableFloat
  /** Samples along each streak; more is smoother and slower. */
  samples?: number
  /**
   * zoom: the whole picture smears towards the centre. rays: only bright parts streak, added on top
   * of the sharp picture (light rays / god rays).
   */
  mode?: 'zoom' | 'rays'
  /** Brightness (0–1) above which a pixel casts rays. */
  threshold?: AnimatableFloat
  /** How bright the rays are added. */
  intensity?: AnimatableFloat
}

/** Radial (zoom) blur: streaks out from a centre point; in rays mode, bright areas cast light rays. */
export function RadialBlurModifier(config: Partial<RadialBlurConfig> = {}): Modifier {
  const centerXRef = config.centerX ?? 0.5
  const centerYRef = config.centerY ?? 0.5
  const strengthRef = config.strength ?? 0.25
  const samples = Math.max(2, Math.min(48, Math.round(config.samples ?? 16)))
  const mode = config.mode ?? 'zoom'
  const thresholdRef = config.threshold ?? 0.55
  const intensityRef = config.intensity ?? 1.2
  let bright = new Uint8ClampedArray(0)

  return {
    type: 'modifier',
    id: 'radial-blur',
    persistent: false,
    config: config,
    init() {},
    destroy() {},
    apply(_ctx: NodeContext, input: FrameBuffer, out: FrameBuffer, signal: Signal): void {
      const { width: w, height: h } = input
      const src = input.data
      const dst = out.data
      const cx = resolveAnimatableFloat(centerXRef, signal) * w
      const cy = resolveAnimatableFloat(centerYRef, signal) * h
      const strength = Math.max(0, Math.min(0.95, resolveAnimatableFloat(strengthRef, signal)))
      let streakSource = src
      if (mode === 'rays') {
        // Only what is bright enough casts rays.
        const threshold = resolveAnimatableFloat(thresholdRef, signal) * 255
        if (bright.length !== src.length) bright = new Uint8ClampedArray(src.length)
        for (let i = 0; i < src.length; i += 4) {
          const l = src[i]! * 0.299 + src[i + 1]! * 0.587 + src[i + 2]! * 0.114
          const k = l > threshold ? (l - threshold) / Math.max(1, 255 - threshold) : 0
          bright[i] = src[i]! * k; bright[i + 1] = src[i + 1]! * k; bright[i + 2] = src[i + 2]! * k
        }
        streakSource = bright
      }
      const intensity = mode === 'rays' ? resolveAnimatableFloat(intensityRef, signal) : 1
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const dx = cx - x
          const dy = cy - y
          let r = 0, g = 0, b = 0, a = 0
          for (let s = 0; s < samples; s++) {
            const k = (s / (samples - 1)) * strength
            const sx = Math.min(w - 1, Math.max(0, Math.round(x + dx * k)))
            const sy = Math.min(h - 1, Math.max(0, Math.round(y + dy * k)))
            const p = (sy * w + sx) * 4
            r += streakSource[p]!; g += streakSource[p + 1]!; b += streakSource[p + 2]!; a += src[p + 3]!
          }
          const o = (y * w + x) * 4
          if (mode === 'rays') {
            const k = intensity / samples
            dst[o] = src[o]! + r * k; dst[o + 1] = src[o + 1]! + g * k; dst[o + 2] = src[o + 2]! + b * k
            // Rays are light: where they cross a transparent background they make it visible.
            dst[o + 3] = Math.max(src[o + 3]!, Math.max(r, g, b) * k)
          } else {
            dst[o] = r / samples; dst[o + 1] = g / samples; dst[o + 2] = b / samples
            dst[o + 3] = a / samples
          }
        }
      }
    },
  }
}
