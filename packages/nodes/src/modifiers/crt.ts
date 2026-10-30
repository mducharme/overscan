import { bindTexture, createFullscreenPipeline, type FullscreenPipeline } from '../webgl/fullscreen.js'
import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Modifier,
  type NodeContext,
  type Signal,
} from '@overscan/types'

export interface CRTConfig {
  scanlineStrength?: AnimatableFloat
  barrelDistortion?: AnimatableFloat
  vignetteStrength?: AnimatableFloat
  vignetteRadius?: AnimatableFloat
  phosphorGlow?: AnimatableFloat
  rgbMask?: boolean
  curvature?: AnimatableFloat
  brightness?: AnimatableFloat
}

export function CRTModifier(config: Partial<CRTConfig> = {}): Modifier {
  const scan = config.scanlineStrength ?? 0.35
  const barrel = config.barrelDistortion ?? 0.1
  const vig  = config.vignetteStrength ?? 0.15
  const vigRadius = config.vignetteRadius ?? 0.7
  const glow = config.phosphorGlow ?? 0
  const rgbMask = config.rgbMask ?? false
  const curvature = config.curvature ?? 0.1
  const brightness = config.brightness ?? 1
  let pipeline: FullscreenPipeline | null = null

  function ensureGpu(ctx: NodeContext): void {
    const gl = ctx.gl
    if (!gl || pipeline) return
    pipeline = createFullscreenPipeline(gl, `#version 300 es
precision mediump float;
uniform sampler2D u_input;
uniform float u_scan;
uniform float u_barrel;
uniform float u_vig;
uniform float u_vigRadius;
uniform float u_glow;
uniform float u_rgbMask;
uniform float u_curvature;
uniform float u_brightness;
uniform vec2 u_resolution;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  vec2 centered = v_uv * 2.0 - 1.0;
  float dist2 = dot(centered, centered);
  vec2 warped = centered * (1.0 + dist2 * (u_barrel + u_curvature));
  vec2 uv = vec2(warped * 0.5 + 0.5);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec4 src = texture(u_input, uv);
  float y = floor(gl_FragCoord.y);
  float darken = mod(y, 2.0) > 0.5 ? 1.0 - u_scan * 0.5 : 1.0;
  vec2 p = (gl_FragCoord.xy - 0.5 * u_resolution) / length(0.5 * u_resolution);
  float vign = 1.0 - u_vig * max(0.0, dot(p, p) - u_vigRadius * 0.5);
  vec3 rgb = src.rgb * darken * vign * u_brightness;
  if (u_glow > 0.0) rgb += src.rgb * u_glow * 0.15;
  if (u_rgbMask > 0.5) {
    float mask = 0.88 + 0.12 * sin(gl_FragCoord.x * 3.14159);
    rgb *= vec3(mask, 1.0, 1.0 - (mask - 0.88));
  }
  fragColor = vec4(clamp(rgb, 0.0, 1.0), src.a);
}`, ['u_input', 'u_scan', 'u_barrel', 'u_vig', 'u_vigRadius', 'u_glow', 'u_rgbMask', 'u_curvature', 'u_brightness', 'u_resolution'])
  }

  return {
    type:       'modifier',
    id:         'crt',
    persistent: false,
    glsl:       'gpu-crt',
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
      const ss = Math.min(1, Math.max(0, resolveAnimatableFloat(scan, signal)))
      const bs = resolveAnimatableFloat(barrel, signal)
      const vs = Math.min(1, Math.max(0, resolveAnimatableFloat(vig, signal)))
      const vr = Math.max(0.1, resolveAnimatableFloat(vigRadius, signal))
      const pg = Math.max(0, Math.min(1, resolveAnimatableFloat(glow, signal)))
      const curv = resolveAnimatableFloat(curvature, signal)
      const bright = Math.max(0, resolveAnimatableFloat(brightness, signal))
      if (ctx.gl && out.fbo && input.texture && pipeline) {
        const gl = ctx.gl
        gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo)
        gl.viewport(0, 0, out.width, out.height)
        gl.useProgram(pipeline.program)
        gl.bindVertexArray(pipeline.vao)
        bindTexture(gl, 0, input.texture, pipeline.uniforms['u_input'] ?? null)
        gl.uniform1f(pipeline.uniforms['u_scan'] ?? null, ss)
        gl.uniform1f(pipeline.uniforms['u_barrel'] ?? null, bs)
        gl.uniform1f(pipeline.uniforms['u_vig'] ?? null, vs)
        gl.uniform1f(pipeline.uniforms['u_vigRadius'] ?? null, vr)
        gl.uniform1f(pipeline.uniforms['u_glow'] ?? null, pg)
        gl.uniform1f(pipeline.uniforms['u_rgbMask'] ?? null, rgbMask ? 1 : 0)
        gl.uniform1f(pipeline.uniforms['u_curvature'] ?? null, curv)
        gl.uniform1f(pipeline.uniforms['u_brightness'] ?? null, bright)
        gl.uniform2f(pipeline.uniforms['u_resolution'] ?? null, out.width, out.height)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        return
      }
      const { width: w, height: h, data: src } = input
      const dst = out.data
      const cx = w / 2
      const cy = h / 2

      for (let y = 0; y < h; y++) {
        const darken = (y & 1) === 1 ? 1 - ss * 0.5 : 1
        for (let x = 0; x < w; x++) {
          const nx = (x - cx) / Math.max(1, cx)
          const ny = (y - cy) / Math.max(1, cy)
          const d2 = nx * nx + ny * ny
          const wx = nx * (1 + d2 * (bs + curv))
          const wy = ny * (1 + d2 * (bs + curv))
          const sx = Math.round((wx * 0.5 + 0.5) * (w - 1))
          const sy = Math.round((wy * 0.5 + 0.5) * (h - 1))
          const i = (y * w + x) * 4
          if (sx < 0 || sy < 0 || sx >= w || sy >= h) {
            dst[i] = 0
            dst[i + 1] = 0
            dst[i + 2] = 0
            dst[i + 3] = 255
            continue
          }
          const si = (sy * w + sx) * 4
          const r = Math.sqrt(d2)
          const vign = 1 - vs * Math.max(0, r * r - vr * 0.25)
          const k = darken * vign
          let rr = Math.round((src[si + 0] ?? 0) * k * bright + (src[si + 0] ?? 0) * pg * 0.15)
          let gg = Math.round((src[si + 1] ?? 0) * k * bright + (src[si + 1] ?? 0) * pg * 0.15)
          let bb = Math.round((src[si + 2] ?? 0) * k * bright + (src[si + 2] ?? 0) * pg * 0.15)
          if (rgbMask) {
            const mask = x % 3
            rr = Math.round(rr * (mask === 0 ? 1 : 0.82))
            gg = Math.round(gg * (mask === 1 ? 1 : 0.82))
            bb = Math.round(bb * (mask === 2 ? 1 : 0.82))
          }
          dst[i + 0] = Math.min(255, Math.max(0, rr))
          dst[i + 1] = Math.min(255, Math.max(0, gg))
          dst[i + 2] = Math.min(255, Math.max(0, bb))
          dst[i + 3] = src[si + 3] ?? 255
        }
      }
      if (ctx.gl && out.texture) {
        const gl = ctx.gl
        gl.bindTexture(gl.TEXTURE_2D, out.texture)
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          out.width,
          out.height,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          out.data,
        )
      }
    },
  }
}
