import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Modifier,
  type NodeContext,
  type Signal,
} from '@overscan/types'
import { wrap } from '../color.js'
import { createFullscreenPipeline, drawFullscreen, PIXEL_GLSL, type FullscreenPipeline } from '../webgl/fullscreen.js'
import { scaleThickness } from '../viewport-scale.js'

export interface WobbleConfig {
  /** Largest shift in pixels (at 640×360). */
  amplitude?: AnimatableFloat
  /** Sine waves per frame height (or width, for vertical wobble). */
  waves?: AnimatableFloat
  /** Wave phase speed in radians per second. */
  speed?: AnimatableFloat
  /** Horizontal shifts each scanline; vertical shifts each column; both does both. */
  direction?: 'horizontal' | 'vertical' | 'both'
  /** What shows where the picture moved away: its other side (wrap), the edge pixel (clamp), or nothing. */
  edges?: 'wrap' | 'clamp' | 'transparent'
  /** Second, faster sine mixed in (0–1) for a less regular, more liquid wobble. */
  turbulence?: AnimatableFloat
}

/**
 * Raster wobble: every scanline (or column) of the input is shifted by a sine of its position and
 * time, the classic wobbling logo.
 */
export function WobbleModifier(config: Partial<WobbleConfig> = {}): Modifier {
  const amplitudeRef = config.amplitude ?? 16
  const wavesRef = config.waves ?? 2
  const speedRef = config.speed ?? 3
  const turbulenceRef = config.turbulence ?? 0
  const direction = config.direction ?? 'horizontal'
  const edges = config.edges ?? 'transparent'

  let pipeline: FullscreenPipeline | null = null

  return {
    type: 'modifier',
    id: 'wobble',
    persistent: false,
    glsl: 'gpu-wobble',
    config: config,
    init(ctx: NodeContext) {
      if (ctx.gl && !pipeline) pipeline = createFullscreenPipeline(ctx.gl, WOBBLE_GLSL, ['u_input', 'u_size', 'u_amp', 'u_waves', 'u_phase', 'u_turbulence', 'u_direction', 'u_edges'])
    },
    destroy() { pipeline = null },
    apply(ctx: NodeContext, input: FrameBuffer, out: FrameBuffer, signal: Signal): void {
      const { width: w, height: h } = input
      const src = input.data
      const dst = out.data
      const amp = scaleThickness(resolveAnimatableFloat(amplitudeRef, signal), w, h)
      const waves = resolveAnimatableFloat(wavesRef, signal)
      const phase = resolveAnimatableFloat(speedRef, signal) * signal.t
      const turbulence = Math.max(0, Math.min(1, resolveAnimatableFloat(turbulenceRef, signal)))
      if (ctx.gl && out.fbo && input.texture && pipeline) {
        drawFullscreen(ctx.gl, pipeline, out.fbo, w, h, input.texture, u => {
          const gl = ctx.gl!
          gl.uniform2i(u['u_size'] ?? null, w, h)
          gl.uniform1f(u['u_amp'] ?? null, amp)
          gl.uniform1f(u['u_waves'] ?? null, waves)
          gl.uniform1f(u['u_phase'] ?? null, phase)
          gl.uniform1f(u['u_turbulence'] ?? null, turbulence)
          gl.uniform1i(u['u_direction'] ?? null, direction === 'horizontal' ? 0 : direction === 'vertical' ? 1 : 2)
          gl.uniform1i(u['u_edges'] ?? null, edges === 'transparent' ? 0 : edges === 'wrap' ? 1 : 2)
        })
        return
      }
      const shiftAt = (pos: number, span: number): number => {
        const a = (pos / span) * waves * Math.PI * 2 + phase
        return amp * ((1 - turbulence) * Math.sin(a) + turbulence * Math.sin(a * 2.7 - phase * 1.9))
      }
      const rowShift = new Float32Array(h)
      const colShift = new Float32Array(w)
      if (direction !== 'vertical') for (let y = 0; y < h; y++) rowShift[y] = shiftAt(y, h)
      if (direction !== 'horizontal') for (let x = 0; x < w; x++) colShift[x] = shiftAt(x, w)
      for (let y = 0; y < h; y++) {
        const dx = rowShift[y]!
        for (let x = 0; x < w; x++) {
          let sx = Math.round(x - dx)
          let sy = Math.round(y - colShift[x]!)
          const o = (y * w + x) * 4
          if (sx < 0 || sx >= w || sy < 0 || sy >= h) {
            if (edges === 'transparent') {
              dst[o] = 0; dst[o + 1] = 0; dst[o + 2] = 0; dst[o + 3] = 0
              continue
            }
            sx = edges === 'wrap' ? wrap(sx, w) : Math.max(0, Math.min(w - 1, sx))
            sy = edges === 'wrap' ? wrap(sy, h) : Math.max(0, Math.min(h - 1, sy))
          }
          const s = (sy * w + sx) * 4
          dst[o] = src[s]!; dst[o + 1] = src[s + 1]!; dst[o + 2] = src[s + 2]!; dst[o + 3] = src[s + 3]!
        }
      }
    },
  }
}

/** GPU twin of the CPU loop: the same per-row and per-column shifts, rounding and edge handling. */
const WOBBLE_GLSL = `#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform ivec2 u_size;
uniform float u_amp;
uniform float u_waves;
uniform float u_phase;
uniform float u_turbulence;
uniform int u_direction;
uniform int u_edges;
out vec4 fragColor;
${PIXEL_GLSL}
float shiftAt(float pos, float span) {
  float a = pos / span * u_waves * 6.283185307179586 + u_phase;
  return u_amp * ((1.0 - u_turbulence) * sin(a) + u_turbulence * sin(a * 2.7 - u_phase * 1.9));
}
int wrapInt(int v, int n) { return ((v % n) + n) % n; }
void main() {
  ivec2 p = pixelCoord();
  float dx = u_direction != 1 ? shiftAt(float(p.y), float(u_size.y)) : 0.0;
  float dy = u_direction != 0 ? shiftAt(float(p.x), float(u_size.x)) : 0.0;
  ivec2 s = ivec2(jsRound(float(p.x) - dx), jsRound(float(p.y) - dy));
  if (s.x < 0 || s.y < 0 || s.x >= u_size.x || s.y >= u_size.y) {
    if (u_edges == 0) { fragColor = vec4(0.0); return; }
    s = u_edges == 1 ? ivec2(wrapInt(s.x, u_size.x), wrapInt(s.y, u_size.y)) : clamp(s, ivec2(0), u_size - 1);
  }
  fragColor = texelFetch(u_input, s, 0);
}`
