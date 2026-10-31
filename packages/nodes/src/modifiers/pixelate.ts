import { bindTexture, createFullscreenPipeline, type FullscreenPipeline } from '../webgl/fullscreen.js'
import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Modifier,
  type NodeContext,
  type Signal,
} from '@overscan/types'

export interface PixelateConfig {
  size?: AnimatableFloat
  blockSize?: AnimatableFloat
  shape?: 'square' | 'circle' | 'diamond'
}

export function PixelateModifier(config: Partial<PixelateConfig> = {}): Modifier {
  const sizeRef = config.blockSize ?? config.size ?? 8
  const shape = config.shape ?? 'square'
  let pipeline: FullscreenPipeline | null = null

  function ensureGpu(ctx: NodeContext): void {
    const gl = ctx.gl
    if (!gl || pipeline) return
    pipeline = createFullscreenPipeline(gl, `#version 300 es
precision mediump float;
uniform sampler2D u_input;
uniform vec2 u_resolution;
uniform float u_size;
uniform float u_shape;
in vec2 v_uv;
out vec4 fragColor;
bool insideShape(vec2 local, float shapeMode) {
  vec2 p = local * 2.0 - 1.0;
  if (shapeMode < 0.5) return true;
  if (shapeMode < 1.5) return dot(p, p) <= 1.0;
  return abs(p.x) + abs(p.y) <= 1.0;
}
void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 block = max(vec2(1.0), vec2(u_size));
  vec2 samplePos = (floor(frag / block) + 0.5) * block;
  // Textures store the top row first, like gl_FragCoord here: no flip between them.
  vec2 uv = samplePos / u_resolution;
  vec4 src = texture(u_input, v_uv);
  vec4 pix = texture(u_input, uv);
  vec2 local = fract(frag / block);
  fragColor = insideShape(local, u_shape) ? pix : src;
}`, ['u_input', 'u_resolution', 'u_size', 'u_shape'])
  }

  return {
    type: 'modifier',
    id: 'pixelate',
    persistent: false,
    glsl: 'gpu-pixelate',
    config: config,
    init(ctx: NodeContext) {
      ensureGpu(ctx)
    },
    destroy() {
      pipeline = null
    },
    apply(ctx: NodeContext, input: FrameBuffer, out: FrameBuffer, signal: Signal): void {
      const size = Math.max(1, Math.round(resolveAnimatableFloat(sizeRef, signal)))
      if (ctx.gl && out.fbo && input.texture && pipeline) {
        const gl = ctx.gl
        gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo)
        gl.viewport(0, 0, out.width, out.height)
        gl.useProgram(pipeline.program)
        gl.bindVertexArray(pipeline.vao)
        bindTexture(gl, 0, input.texture, pipeline.uniforms['u_input'] ?? null)
        gl.uniform2f(pipeline.uniforms['u_resolution'] ?? null, out.width, out.height)
        gl.uniform1f(pipeline.uniforms['u_size'] ?? null, size)
        gl.uniform1f(pipeline.uniforms['u_shape'] ?? null, shape === 'circle' ? 1 : shape === 'diamond' ? 2 : 0)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        return
      }

      const { width: w, height: h, data: src } = input
      const dst = out.data
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const sx = Math.min(w - 1, Math.floor(x / size) * size + Math.floor(size / 2))
          const sy = Math.min(h - 1, Math.floor(y / size) * size + Math.floor(size / 2))
          const s = (sy * w + sx) * 4
          const d = (y * w + x) * 4
          const localX = ((x % size) + 0.5) / size * 2 - 1
          const localY = ((y % size) + 0.5) / size * 2 - 1
          const inside = shape === 'square'
            || (shape === 'circle' && localX * localX + localY * localY <= 1)
            || (shape === 'diamond' && Math.abs(localX) + Math.abs(localY) <= 1)
          dst[d] = inside ? (src[s] ?? 0) : (src[d] ?? 0)
          dst[d + 1] = inside ? (src[s + 1] ?? 0) : (src[d + 1] ?? 0)
          dst[d + 2] = inside ? (src[s + 2] ?? 0) : (src[d + 2] ?? 0)
          dst[d + 3] = inside ? (src[s + 3] ?? 255) : (src[d + 3] ?? 255)
        }
      }
    },
  }
}
