import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Modifier,
  type NodeContext,
  type Signal,
} from '@overscan/types'
import { createFullscreenPipeline, drawFullscreen, PIXEL_GLSL, type FullscreenPipeline } from '../webgl/fullscreen.js'

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
  let pipeline: FullscreenPipeline | null = null

  return {
    type: 'modifier',
    id: 'radial-blur',
    persistent: false,
    glsl: 'gpu-radial-blur',
    config: config,
    init(ctx: NodeContext) {
      if (ctx.gl && !pipeline) pipeline = createFullscreenPipeline(ctx.gl, RADIAL_BLUR_GLSL, ['u_input', 'u_size', 'u_center', 'u_strength', 'u_samples', 'u_rays', 'u_threshold', 'u_intensity'])
    },
    destroy() { pipeline = null },
    apply(ctx: NodeContext, input: FrameBuffer, out: FrameBuffer, signal: Signal): void {
      const { width: w, height: h } = input
      const src = input.data
      const dst = out.data
      const cx = resolveAnimatableFloat(centerXRef, signal) * w
      const cy = resolveAnimatableFloat(centerYRef, signal) * h
      const strength = Math.max(0, Math.min(0.95, resolveAnimatableFloat(strengthRef, signal)))
      if (ctx.gl && out.fbo && input.texture && pipeline) {
        const threshold = resolveAnimatableFloat(thresholdRef, signal)
        const intensity = resolveAnimatableFloat(intensityRef, signal)
        drawFullscreen(ctx.gl, pipeline, out.fbo, w, h, input.texture, u => {
          const gl = ctx.gl!
          gl.uniform2i(u['u_size'] ?? null, w, h)
          gl.uniform2f(u['u_center'] ?? null, cx, cy)
          gl.uniform1f(u['u_strength'] ?? null, strength)
          gl.uniform1i(u['u_samples'] ?? null, samples)
          gl.uniform1i(u['u_rays'] ?? null, mode === 'rays' ? 1 : 0)
          gl.uniform1f(u['u_threshold'] ?? null, threshold)
          gl.uniform1f(u['u_intensity'] ?? null, intensity)
        })
        return
      }
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

/** GPU twin of the CPU loop above: the same sample positions, bright pass and alpha. */
const RADIAL_BLUR_GLSL = `#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform ivec2 u_size;
uniform vec2 u_center;
uniform float u_strength;
uniform int u_samples;
uniform int u_rays;
uniform float u_threshold;
uniform float u_intensity;
out vec4 fragColor;
${PIXEL_GLSL}
vec3 streak(vec4 c) {
  if (u_rays == 0) return c.rgb;
  float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  float k = l > u_threshold ? (l - u_threshold) / max(1.0 / 255.0, 1.0 - u_threshold) : 0.0;
  return c.rgb * k;
}
void main() {
  ivec2 p = pixelCoord();
  vec2 d = u_center - vec2(p);
  vec3 sum = vec3(0.0);
  float alpha = 0.0;
  for (int s = 0; s < 48; s++) {
    if (s >= u_samples) break;
    float k = float(s) / float(u_samples - 1) * u_strength;
    vec4 c = texel(u_input, ivec2(jsRound(float(p.x) + d.x * k), jsRound(float(p.y) + d.y * k)), u_size);
    sum += streak(c);
    alpha += c.a;
  }
  vec4 src = texel(u_input, p, u_size);
  if (u_rays == 1) {
    float k = u_intensity / float(u_samples);
    // Rays are light: where they cross a transparent background they make it visible.
    fragColor = vec4(min(vec3(1.0), src.rgb + sum * k), max(src.a, min(1.0, max(sum.r, max(sum.g, sum.b)) * k)));
  } else {
    fragColor = vec4(sum, alpha) / float(u_samples);
  }
}`
