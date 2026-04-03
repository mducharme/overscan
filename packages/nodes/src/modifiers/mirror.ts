import { bindTexture, createFullscreenPipeline, type FullscreenPipeline } from '../webgl/fullscreen.js'
import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Modifier,
  type NodeContext,
  type Signal,
} from '@overscan/types'

export interface MirrorConfig {
  mode?: 'horizontal' | 'vertical' | 'quad' | 'octal'
  originX?: AnimatableFloat
  originY?: AnimatableFloat
}

export function MirrorModifier(config: Partial<MirrorConfig> = {}): Modifier {
  const mode = config.mode ?? 'quad'
  const originXRef = config.originX ?? 0.5
  const originYRef = config.originY ?? 0.5
  let pipeline: FullscreenPipeline | null = null

  function ensureGpu(ctx: NodeContext): void {
    const gl = ctx.gl
    if (!gl || pipeline) return
    pipeline = createFullscreenPipeline(gl, `#version 300 es
precision mediump float;
uniform sampler2D u_input;
uniform vec2 u_origin;
uniform float u_mode;
in vec2 v_uv;
out vec4 fragColor;
vec2 mirrorUv(vec2 uv, vec2 origin, float mode) {
  vec2 p = uv - origin;
  if (mode < 0.5) p.x = abs(p.x);
  else if (mode < 1.5) p.y = abs(p.y);
  else if (mode < 2.5) p = abs(p);
  else {
    p = abs(p);
    if (p.x < p.y) p = p.yx;
  }
  return origin + p;
}
void main() {
  vec2 uv = v_uv;
  vec2 muv = mirrorUv(uv, u_origin, u_mode);
  muv = clamp(muv, vec2(0.0), vec2(1.0));
  fragColor = texture(u_input, muv);
}`, ['u_input', 'u_origin', 'u_mode'])
  }

  return {
    type: 'modifier',
    id: 'mirror',
    persistent: false,
    glsl: 'gpu-mirror',
    config: config as Modifier['config'],
    init(ctx: NodeContext) { ensureGpu(ctx) },
    destroy() { pipeline = null },
    apply(ctx: NodeContext, input: FrameBuffer, out: FrameBuffer, signal: Signal): void {
      const originX = resolveAnimatableFloat(originXRef, signal)
      const originY = resolveAnimatableFloat(originYRef, signal)
      if (ctx.gl && out.fbo && input.texture && pipeline) {
        const gl = ctx.gl
        gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo)
        gl.viewport(0, 0, out.width, out.height)
        gl.useProgram(pipeline.program)
        gl.bindVertexArray(pipeline.vao)
        bindTexture(gl, 0, input.texture, pipeline.uniforms['u_input'] ?? null)
        gl.uniform2f(pipeline.uniforms['u_origin'] ?? null, originX, originY)
        gl.uniform1f(pipeline.uniforms['u_mode'] ?? null, mode === 'horizontal' ? 0 : mode === 'vertical' ? 1 : mode === 'quad' ? 2 : 3)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        return
      }

      const { width: w, height: h, data: src } = input
      const dst = out.data
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const uvx = x / Math.max(1, w - 1)
          const uvy = y / Math.max(1, h - 1)
          const [mx, my] = mirrorUv(uvx, uvy, originX, originY, mode)
          const sx = Math.max(0, Math.min(w - 1, Math.round(mx * (w - 1))))
          const sy = Math.max(0, Math.min(h - 1, Math.round(my * (h - 1))))
          const si = (sy * w + sx) * 4
          const di = (y * w + x) * 4
          dst[di] = src[si] ?? 0
          dst[di + 1] = src[si + 1] ?? 0
          dst[di + 2] = src[si + 2] ?? 0
          dst[di + 3] = src[si + 3] ?? 255
        }
      }
    },
  }
}

function mirrorUv(
  uvx: number,
  uvy: number,
  originX: number,
  originY: number,
  mode: NonNullable<MirrorConfig['mode']>,
): [number, number] {
  let dx = uvx - originX
  let dy = uvy - originY
  if (mode === 'horizontal') dx = Math.abs(dx)
  else if (mode === 'vertical') dy = Math.abs(dy)
  else if (mode === 'quad') {
    dx = Math.abs(dx)
    dy = Math.abs(dy)
  } else {
    dx = Math.abs(dx)
    dy = Math.abs(dy)
    if (dx < dy) {
      const t = dx
      dx = dy
      dy = t
    }
  }
  return [originX + dx, originY + dy]
}
