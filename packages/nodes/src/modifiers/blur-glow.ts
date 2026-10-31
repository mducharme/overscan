import { bindTexture, createFullscreenPipeline, type FullscreenPipeline } from '../webgl/fullscreen.js'
import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Modifier,
  type NodeContext,
  type Signal,
} from '@overscan/types'

export interface BlurGlowConfig {
  radius?: AnimatableFloat
  mode?: 'blur' | 'glow'
  strength?: AnimatableFloat
  glowStrength?: AnimatableFloat
}

/** Separable box blur (CPU). */
export function BlurGlowModifier(config: Partial<BlurGlowConfig> = {}): Modifier {
  const radiusRef = config.radius ?? 2
  const mode = config.mode ?? 'blur'
  const glowRef = config.strength ?? config.glowStrength ?? 0.5
  let pipeline: FullscreenPipeline | null = null
  let tmp = new Uint8ClampedArray(0)

  function ensureGpu(ctx: NodeContext): void {
    const gl = ctx.gl
    if (!gl || pipeline) return
    pipeline = createFullscreenPipeline(gl, `#version 300 es
precision mediump float;
uniform sampler2D u_input;
uniform vec2 u_texel;
uniform float u_radius;
uniform float u_glow;
uniform float u_mode;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  vec2 uv = v_uv;
  // A box blur of the given radius (at most 8), matching the CPU path's two box passes.
  vec4 c = vec4(0.0);
  float n = 0.0;
  for (int dy = -8; dy <= 8; dy++) {
    if (abs(float(dy)) > u_radius) continue;
    for (int dx = -8; dx <= 8; dx++) {
      if (abs(float(dx)) > u_radius) continue;
      c += texture(u_input, uv + u_texel * vec2(float(dx), float(dy)));
      n += 1.0;
    }
  }
  vec4 blur = c / n;
  vec4 src = texture(u_input, uv);
  fragColor = u_mode > 0.5
    ? vec4(min(vec3(1.0), src.rgb + blur.rgb * u_glow), src.a)
    : blur;
}`, ['u_input', 'u_texel', 'u_radius', 'u_glow', 'u_mode'])
  }

  return {
    type:       'modifier',
    id:         'blur-glow',
    persistent: false,
    glsl:       'gpu-blur-glow',
    config:     config,
    init(ctx: NodeContext) {
      ensureGpu(ctx)
    },
    destroy() {
      pipeline = null
    },
    apply(
      ctx: NodeContext,
      input: FrameBuffer,
      out: FrameBuffer,
      signal: Signal,
    ): void {
      const rIn = Math.max(0, Math.round(resolveAnimatableFloat(radiusRef, signal)))
      const glow = Math.min(1, Math.max(0, resolveAnimatableFloat(glowRef, signal)))
      if (ctx.gl && out.fbo && input.texture && pipeline) {
        const gl = ctx.gl
        const rad = Math.min(rIn, 8)
        gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo)
        gl.viewport(0, 0, out.width, out.height)
        gl.useProgram(pipeline.program)
        gl.bindVertexArray(pipeline.vao)
        bindTexture(gl, 0, input.texture, pipeline.uniforms['u_input'] ?? null)
        gl.uniform2f(pipeline.uniforms['u_texel'] ?? null, 1 / out.width, 1 / out.height)
        gl.uniform1f(pipeline.uniforms['u_radius'] ?? null, rad)
        gl.uniform1f(pipeline.uniforms['u_glow'] ?? null, glow)
        gl.uniform1f(pipeline.uniforms['u_mode'] ?? null, mode === 'glow' ? 1 : 0)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        return
      }
      const { width: w, height: h, data: src } = input
      const { data: dst } = out
      if (tmp.length !== w * h * 4) tmp = new Uint8ClampedArray(w * h * 4)

      const rad = Math.min(rIn, 8)
      boxBlurPass(src, tmp, w, h, rad, 4, w * 4, w, h)
      boxBlurPass(tmp, dst, w, h, rad, w * 4, 4, h, w)

      if (mode === 'glow') {
        for (let i = 0; i < dst.length; i += 4) {
          const sr = src[i] ?? 0
          const sg = src[i + 1] ?? 0
          const sb = src[i + 2] ?? 0
          const sa = src[i + 3] ?? 0
          const br = dst[i] ?? 0
          const bg = dst[i + 1] ?? 0
          const bb = dst[i + 2] ?? 0
          dst[i]     = Math.min(255, Math.round(sr + br * glow))
          dst[i + 1] = Math.min(255, Math.round(sg + bg * glow))
          dst[i + 2] = Math.min(255, Math.round(sb + bb * glow))
          dst[i + 3] = Math.min(255, Math.round(sa))
        }
      }
    },
  }
}

/**
 * One separable box-blur pass with edge clamping, as a sliding window (O(1) per pixel).
 * Sums are integers, so the result is identical to summing all 2·rad+1 taps.
 * `step` walks along the blur axis (length `len`); `lineStride` moves between the `lines` lines.
 */
function boxBlurPass(
  src: Uint8ClampedArray,
  dst: Uint8ClampedArray,
  w: number,
  h: number,
  rad: number,
  step: number,
  lineStride: number,
  len: number,
  lines: number,
): void {
  if (w * h === 0) return
  const samples = rad * 2 + 1
  const last = len - 1
  for (let line = 0; line < lines; line++) {
    const base = line * lineStride
    let r = 0
    let g = 0
    let b = 0
    let a = 0
    for (let k = -rad; k <= rad; k++) {
      const i = base + Math.min(last, Math.max(0, k)) * step
      r += src[i]!
      g += src[i + 1]!
      b += src[i + 2]!
      a += src[i + 3]!
    }
    for (let p = 0; p < len; p++) {
      const o = base + p * step
      dst[o] = r / samples
      dst[o + 1] = g / samples
      dst[o + 2] = b / samples
      dst[o + 3] = a / samples
      const add = base + Math.min(last, p + rad + 1) * step
      const sub = base + Math.max(0, p - rad) * step
      r += src[add]! - src[sub]!
      g += src[add + 1]! - src[sub + 1]!
      b += src[add + 2]! - src[sub + 2]!
      a += src[add + 3]! - src[sub + 3]!
    }
  }
}
