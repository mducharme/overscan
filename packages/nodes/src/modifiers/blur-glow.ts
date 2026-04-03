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

  function ensureGpu(ctx: NodeContext): void {
    const gl = ctx.gl
    if (!gl || pipeline) return
    pipeline = createFullscreenPipeline(gl, `#version 300 es
precision mediump float;
uniform sampler2D u_input;
uniform vec2 u_texel;
uniform float u_glow;
uniform float u_mode;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  vec2 uv = v_uv;
  vec4 c = vec4(0.0);
  c += texture(u_input, uv + u_texel * vec2(-1.0, -1.0));
  c += texture(u_input, uv + u_texel * vec2( 0.0, -1.0));
  c += texture(u_input, uv + u_texel * vec2( 1.0, -1.0));
  c += texture(u_input, uv + u_texel * vec2(-1.0,  0.0));
  c += texture(u_input, uv);
  c += texture(u_input, uv + u_texel * vec2( 1.0,  0.0));
  c += texture(u_input, uv + u_texel * vec2(-1.0,  1.0));
  c += texture(u_input, uv + u_texel * vec2( 0.0,  1.0));
  c += texture(u_input, uv + u_texel * vec2( 1.0,  1.0));
  vec4 blur = c / 9.0;
  vec4 src = texture(u_input, uv);
  fragColor = u_mode > 0.5
    ? vec4(min(vec3(1.0), src.rgb + blur.rgb * u_glow), src.a)
    : blur;
}`, ['u_input', 'u_texel', 'u_glow', 'u_mode'])
  }

  return {
    type:       'modifier',
    id:         'blur-glow',
    persistent: false,
    glsl:       'gpu-blur-glow',
    config:     config as Modifier['config'],
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
        const rad = Math.max(1, Math.min(rIn, 8))
        gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo)
        gl.viewport(0, 0, out.width, out.height)
        gl.useProgram(pipeline.program)
        gl.bindVertexArray(pipeline.vao)
        bindTexture(gl, 0, input.texture, pipeline.uniforms['u_input'] ?? null)
        gl.uniform2f(pipeline.uniforms['u_texel'] ?? null, rad / out.width, rad / out.height)
        gl.uniform1f(pipeline.uniforms['u_glow'] ?? null, glow)
        gl.uniform1f(pipeline.uniforms['u_mode'] ?? null, mode === 'glow' ? 1 : 0)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        return
      }
      const { width: w, height: h, data: src } = input
      const { data: dst } = out
      const tmp = new Uint8ClampedArray(w * h * 4)

      const rad = Math.min(rIn, 8)
      const pass = (srcBuf: Uint8ClampedArray, dstBuf: Uint8ClampedArray, horiz: boolean): void => {
        const samples = rad * 2 + 1
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            let r = 0
            let g = 0
            let b = 0
            let a = 0
            for (let k = -rad; k <= rad; k++) {
              const xx = horiz ? Math.min(w - 1, Math.max(0, x + k)) : x
              const yy = horiz ? y : Math.min(h - 1, Math.max(0, y + k))
              const i = (yy * w + xx) * 4
              r += srcBuf[i] ?? 0
              g += srcBuf[i + 1] ?? 0
              b += srcBuf[i + 2] ?? 0
              a += srcBuf[i + 3] ?? 0
            }
            const o = (y * w + x) * 4
            dstBuf[o] = r / samples
            dstBuf[o + 1] = g / samples
            dstBuf[o + 2] = b / samples
            dstBuf[o + 3] = a / samples
          }
        }
      }

      pass(src, tmp, true)
      pass(tmp, dst, false)

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
