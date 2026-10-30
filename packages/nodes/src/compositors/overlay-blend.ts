import { bindEdgeTransform, bindTexture, createFullscreenPipeline, EDGE_TRANSFORM_GLSL, type FullscreenPipeline } from '../webgl/fullscreen.js'
import { createInputSampler } from './blend-utils.js'
import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type Compositor,
  type CompositorInputMeta,
  type FrameBuffer,
  type NodeContext,
  type Signal,
} from '@overscan/types'

export interface OverlayBlendConfig {
  opacity?: AnimatableFloat
}

function overlayChannel(base: number, over: number): number {
  const b = base / 255
  const o = over / 255
  const v = b < 0.5 ? 2 * b * o : 1 - 2 * (1 - b) * (1 - o)
  return Math.round(v * 255)
}

export function OverlayBlendCompositor(config: Partial<OverlayBlendConfig> = {}): Compositor {
  const opacityRef = config.opacity ?? 1
  let pipeline: FullscreenPipeline | null = null

  function ensureGpu(ctx: NodeContext): void {
    const gl = ctx.gl
    if (!gl || pipeline) return
    pipeline = createFullscreenPipeline(gl, `#version 300 es
precision mediump float;
uniform sampler2D u_base;
uniform sampler2D u_overlay;
uniform sampler2D u_mask;
uniform float u_opacity;
uniform float u_useMask;
uniform vec2 u_basePos;
uniform vec2 u_baseScale;
uniform float u_baseRot;
uniform float u_baseEnabled;
uniform vec2 u_overlayPos;
uniform vec2 u_overlayScale;
uniform float u_overlayRot;
uniform float u_overlayEnabled;
uniform vec2 u_maskPos;
uniform vec2 u_maskScale;
uniform float u_maskRot;
uniform float u_maskEnabled;
in vec2 v_uv;
out vec4 fragColor;
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 overlayBlend(vec3 a, vec3 b) {
  return mix(
    2.0 * a * b,
    1.0 - 2.0 * (1.0 - a) * (1.0 - b),
    step(vec3(0.5), a)
  );
}
${EDGE_TRANSFORM_GLSL}
void main() {
  vec2 baseUv = applyEdgeTransform(v_uv, u_basePos, u_baseScale, u_baseRot, u_baseEnabled);
  vec2 overUv = applyEdgeTransform(v_uv, u_overlayPos, u_overlayScale, u_overlayRot, u_overlayEnabled);
  vec4 base = edgeTransformInside(v_uv, u_basePos, u_baseScale, u_baseRot, u_baseEnabled) ? texture(u_base, baseUv) : vec4(0.0);
  vec4 over = edgeTransformInside(v_uv, u_overlayPos, u_overlayScale, u_overlayRot, u_overlayEnabled) ? texture(u_overlay, overUv) : vec4(0.0);
  float m = u_useMask > 0.5
    ? (edgeTransformInside(v_uv, u_maskPos, u_maskScale, u_maskRot, u_maskEnabled)
      ? luma(texture(u_mask, applyEdgeTransform(v_uv, u_maskPos, u_maskScale, u_maskRot, u_maskEnabled)).rgb)
      : 0.0)
    : 1.0;
  vec3 rgb = mix(base.rgb, overlayBlend(base.rgb, over.rgb), u_opacity * m);
  fragColor = vec4(rgb, max(base.a, over.a));
}`, [
      'u_base', 'u_overlay', 'u_mask', 'u_opacity', 'u_useMask',
      'u_basePos', 'u_baseScale', 'u_baseRot', 'u_baseEnabled',
      'u_overlayPos', 'u_overlayScale', 'u_overlayRot', 'u_overlayEnabled',
      'u_maskPos', 'u_maskScale', 'u_maskRot', 'u_maskEnabled',
    ])
  }

  return {
    type: 'compositor',
    id: 'overlay-blend',
    inputs: ['base', 'overlay', 'mask'],
    mode: 'overlay',
    opacity: opacityRef,
    glsl: 'gpu-overlay-blend',
    config: config,
    init(ctx: NodeContext) { ensureGpu(ctx) },
    destroy() { pipeline = null },
    compose(
      ctx: NodeContext,
      inputs: Readonly<Record<string, FrameBuffer>>,
      out: FrameBuffer,
      signal: Signal,
      inputMeta?: Readonly<Record<string, CompositorInputMeta>>,
    ): void {
      const base = inputs['base']
      const overlay = inputs['overlay']
      if (!base || !overlay) return
      const maskBuf = inputs['mask']
      const opacity = Math.min(1, Math.max(0, resolveAnimatableFloat(opacityRef, signal)))
      const W = out.width
      const H = out.height

      if (ctx.gl && out.fbo && pipeline && base.texture && overlay.texture) {
        const gl = ctx.gl
        gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo)
        gl.viewport(0, 0, W, H)
        gl.useProgram(pipeline.program)
        gl.bindVertexArray(pipeline.vao)
        bindTexture(gl, 0, base.texture, pipeline.uniforms['u_base'] ?? null)
        bindTexture(gl, 1, overlay.texture, pipeline.uniforms['u_overlay'] ?? null)
        if (maskBuf?.texture) bindTexture(gl, 2, maskBuf.texture, pipeline.uniforms['u_mask'] ?? null)
        gl.uniform1f(pipeline.uniforms['u_opacity'] ?? null, opacity)
        gl.uniform1f(pipeline.uniforms['u_useMask'] ?? null, maskBuf?.texture ? 1 : 0)
        bindEdgeTransform(gl, pipeline.uniforms, 'u_base', inputMeta?.['base']?.transform)
        bindEdgeTransform(gl, pipeline.uniforms, 'u_overlay', inputMeta?.['overlay']?.transform)
        bindEdgeTransform(gl, pipeline.uniforms, 'u_mask', inputMeta?.['mask']?.transform)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        return
      }

      const sampler = createInputSampler(base, overlay, maskBuf, W, H, inputMeta)

      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const { br, bg, bb, ba, or, og, ob, oa, mask } = sampler.sample(x, y)
          const k = opacity * mask
          const o = (y * W + x) * 4
          const rr = overlayChannel(br, or)
          const rg = overlayChannel(bg, og)
          const rb = overlayChannel(bb, ob)
          out.data[o] = Math.round(br * (1 - k) + rr * k)
          out.data[o + 1] = Math.round(bg * (1 - k) + rg * k)
          out.data[o + 2] = Math.round(bb * (1 - k) + rb * k)
          out.data[o + 3] = Math.max(ba, oa)
        }
      }
    },
  }
}
