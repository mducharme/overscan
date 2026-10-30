import { bindTexture, createFullscreenPipeline, type FullscreenPipeline } from '../webgl/fullscreen.js'
import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type BlendMode,
  type FrameBuffer,
  type Modifier,
  type NodeContext,
  type Signal,
} from '@overscan/types'

function parseColor(hex: string): [number, number, number] {
  const m = /^#?([\da-fA-F]{6})$/.exec(hex.trim())
  if (m) {
    const n = parseInt(m[1] ?? '000000', 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  return [255, 255, 255]
}

export interface PaletteFlashConfig {
  color?: string
  strength?: AnimatableFloat
  blendMode?: BlendMode
}

export function PaletteFlashModifier(config: Partial<PaletteFlashConfig> = {}): Modifier {
  const colorHex = config.color ?? '#ffffff'
  const strengthRef = config.strength ?? 0
  const blendMode = config.blendMode ?? 'alpha'
  let pipeline: FullscreenPipeline | null = null

  function ensureGpu(ctx: NodeContext): void {
    const gl = ctx.gl
    if (!gl || pipeline) return
    pipeline = createFullscreenPipeline(gl, `#version 300 es
precision mediump float;
uniform sampler2D u_input;
uniform vec3 u_flash;
uniform float u_strength;
uniform float u_mode;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  vec4 src = texture(u_input, v_uv);
  vec3 rgb = src.rgb;
  if (u_mode > 0.5) {
    rgb = min(vec3(1.0), rgb + u_flash * u_strength);
  } else {
    rgb = mix(rgb, u_flash, u_strength);
  }
  fragColor = vec4(rgb, src.a);
}`, ['u_input', 'u_flash', 'u_strength', 'u_mode'])
  }

  return {
    type:       'modifier',
    id:         'palette-flash',
    persistent: false,
    glsl:       'gpu-palette-flash',
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
      const s = Math.min(1, Math.max(0, resolveAnimatableFloat(strengthRef, signal)))
      if (s <= 0) {
        out.data.set(input.data)
        return
      }
      const [fr, fg, fb] = parseColor(colorHex)
      if (ctx.gl && out.fbo && input.texture && pipeline) {
        const gl = ctx.gl
        gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo)
        gl.viewport(0, 0, out.width, out.height)
        gl.useProgram(pipeline.program)
        gl.bindVertexArray(pipeline.vao)
        bindTexture(gl, 0, input.texture, pipeline.uniforms['u_input'] ?? null)
        gl.uniform3f(pipeline.uniforms['u_flash'] ?? null, fr / 255, fg / 255, fb / 255)
        gl.uniform1f(pipeline.uniforms['u_strength'] ?? null, s)
        gl.uniform1f(pipeline.uniforms['u_mode'] ?? null, blendMode === 'additive' ? 1 : 0)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        return
      }
      const { width: w, height: h, data: src } = input
      const dst = out.data

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4
          const r = src[i] ?? 0
          const g = src[i + 1] ?? 0
          const b = src[i + 2] ?? 0
          const a = src[i + 3] ?? 255
          if (blendMode === 'additive') {
            dst[i]     = Math.min(255, Math.round(r + fr * s))
            dst[i + 1] = Math.min(255, Math.round(g + fg * s))
            dst[i + 2] = Math.min(255, Math.round(b + fb * s))
          } else {
            dst[i]     = Math.round(r * (1 - s) + fr * s)
            dst[i + 1] = Math.round(g * (1 - s) + fg * s)
            dst[i + 2] = Math.round(b * (1 - s) + fb * s)
          }
          dst[i + 3] = a
        }
      }
    },
  }
}
