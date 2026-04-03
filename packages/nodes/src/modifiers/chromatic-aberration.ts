import { bindTexture, createFullscreenPipeline, type FullscreenPipeline } from '../webgl/fullscreen.js'
import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Modifier,
  type NodeContext,
  type Signal,
} from '@overscan/types'

export interface ChromaticAberrationConfig {
  amount?: AnimatableFloat
  strength?: AnimatableFloat
  angle?: AnimatableFloat
  radial?: boolean
}

function sampleChannel(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y: number,
  channel: number,
): number {
  const sx = Math.max(0, Math.min(w - 1, Math.round(x)))
  const sy = Math.max(0, Math.min(h - 1, Math.round(y)))
  return data[(sy * w + sx) * 4 + channel] ?? 0
}

export function ChromaticAberrationModifier(config: Partial<ChromaticAberrationConfig> = {}): Modifier {
  const amountRef = config.strength ?? config.amount ?? 3
  const angleRef = config.angle ?? 0
  const radial = config.radial ?? false
  let pipeline: FullscreenPipeline | null = null

  function ensureGpu(ctx: NodeContext): void {
    const gl = ctx.gl
    if (!gl || pipeline) return
    pipeline = createFullscreenPipeline(gl, `#version 300 es
precision mediump float;
uniform sampler2D u_input;
uniform vec2 u_resolution;
uniform float u_amount;
uniform vec2 u_dir;
uniform float u_radial;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  vec2 uv = v_uv;
  float edge = u_radial > 0.5 ? length(v_uv - vec2(0.5)) * 2.0 : 1.0;
  vec2 texel = u_dir * ((u_amount * edge) / max(u_resolution, vec2(1.0)));
  float r = texture(u_input, uv + texel).r;
  float g = texture(u_input, uv).g;
  float b = texture(u_input, uv - texel).b;
  float a = texture(u_input, uv).a;
  fragColor = vec4(r, g, b, a);
}`, ['u_input', 'u_resolution', 'u_amount', 'u_dir', 'u_radial'])
  }

  return {
    type: 'modifier',
    id: 'chromatic-aberration',
    persistent: false,
    glsl: 'gpu-chromatic-aberration',
    config: config as Modifier['config'],
    init(ctx: NodeContext) {
      ensureGpu(ctx)
    },
    destroy() {
      pipeline = null
    },
    apply(ctx: NodeContext, input: FrameBuffer, out: FrameBuffer, signal: Signal): void {
      const amount = Math.max(0, resolveAnimatableFloat(amountRef, signal))
      const angle = resolveAnimatableFloat(angleRef, signal)
      const dx = Math.cos(angle)
      const dy = Math.sin(angle)
      if (ctx.gl && out.fbo && input.texture && pipeline) {
        const gl = ctx.gl
        gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo)
        gl.viewport(0, 0, out.width, out.height)
        gl.useProgram(pipeline.program)
        gl.bindVertexArray(pipeline.vao)
        bindTexture(gl, 0, input.texture, pipeline.uniforms['u_input'] ?? null)
        gl.uniform2f(pipeline.uniforms['u_resolution'] ?? null, out.width, out.height)
        gl.uniform1f(pipeline.uniforms['u_amount'] ?? null, amount)
        gl.uniform2f(pipeline.uniforms['u_dir'] ?? null, dx, dy)
        gl.uniform1f(pipeline.uniforms['u_radial'] ?? null, radial ? 1 : 0)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        return
      }

      const { width: w, height: h, data: src } = input
      const dst = out.data
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const d = (y * w + x) * 4
          const edge = radial
            ? Math.sqrt(((x / Math.max(1, w - 1)) - 0.5) ** 2 + ((y / Math.max(1, h - 1)) - 0.5) ** 2) * 2
            : 1
          const shift = amount * edge
          dst[d] = sampleChannel(src, w, h, x + dx * shift, y + dy * shift, 0)
          dst[d + 1] = sampleChannel(src, w, h, x, y, 1)
          dst[d + 2] = sampleChannel(src, w, h, x - dx * shift, y - dy * shift, 2)
          dst[d + 3] = sampleChannel(src, w, h, x, y, 3)
        }
      }
    },
  }
}
