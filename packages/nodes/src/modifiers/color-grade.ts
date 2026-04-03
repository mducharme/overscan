import { bindTexture, createFullscreenPipeline, type FullscreenPipeline } from '../webgl/fullscreen.js'
import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Modifier,
  type NodeContext,
  type Signal,
} from '@overscan/types'

export interface ColorGradeConfig {
  mode?: '1d' | '3d' | 'curves'
  palette?: Array<[number, number, number]>
  lutUrl?: string
  curves?: { r?: number[]; g?: number[]; b?: number[] }
  strength?: AnimatableFloat
}

const DEFAULT_PALETTE: Array<[number, number, number]> = [
  [18, 14, 40],
  [80, 54, 128],
  [255, 126, 96],
  [255, 236, 204],
]

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function gradeSample(luma: number, palette: Array<[number, number, number]>): [number, number, number] {
  const colors = palette.length > 1 ? palette : DEFAULT_PALETTE
  const scaled = Math.max(0, Math.min(1, luma)) * (colors.length - 1)
  const idx = Math.min(colors.length - 2, Math.floor(scaled))
  const t = scaled - idx
  const fallback = colors[0] ?? DEFAULT_PALETTE[0]!
  const a = colors[idx] ?? fallback
  const b = colors[idx + 1] ?? a
  return [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t)),
  ]
}

export function ColorGradeModifier(config: Partial<ColorGradeConfig> = {}): Modifier {
  const mode = config.mode ?? '1d'
  const palette = (config.palette?.length ? config.palette : DEFAULT_PALETTE).slice(0, 8)
  const curves = config.curves
  const strengthRef = config.strength ?? 1
  let pipeline: FullscreenPipeline | null = null

  function ensureGpu(ctx: NodeContext): void {
    const gl = ctx.gl
    if (!gl || pipeline) return
    pipeline = createFullscreenPipeline(gl, `#version 300 es
precision mediump float;
uniform sampler2D u_input;
uniform float u_strength;
uniform float u_count;
uniform vec3 u_palette[8];
in vec2 v_uv;
out vec4 fragColor;
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 lutSample(float x) {
  float count = max(2.0, u_count);
  float scaled = clamp(x, 0.0, 1.0) * (count - 1.0);
  float idx = floor(scaled);
  float nextIdx = min(count - 1.0, idx + 1.0);
  float t = fract(scaled);
  vec3 a = u_palette[int(idx)];
  vec3 b = u_palette[int(nextIdx)];
  return mix(a, b, t);
}
void main() {
  vec2 uv = v_uv;
  vec4 src = texture(u_input, uv);
  vec3 graded = lutSample(luma(src.rgb));
  fragColor = vec4(mix(src.rgb, graded, u_strength), src.a);
}`, ['u_input', 'u_strength', 'u_count', 'u_palette[0]', 'u_palette[1]', 'u_palette[2]', 'u_palette[3]', 'u_palette[4]', 'u_palette[5]', 'u_palette[6]', 'u_palette[7]'])
  }

  return {
    type: 'modifier',
    id: 'color-grade',
    persistent: false,
    glsl: 'gpu-color-grade',
    config: config as Modifier['config'],
    init(ctx: NodeContext) {
      ensureGpu(ctx)
    },
    destroy() {
      pipeline = null
    },
    apply(ctx: NodeContext, input: FrameBuffer, out: FrameBuffer, signal: Signal): void {
      const strength = Math.max(0, Math.min(1, resolveAnimatableFloat(strengthRef, signal)))
      if (strength <= 0) {
        out.data.set(input.data)
        return
      }
      if (mode === '1d' && ctx.gl && out.fbo && input.texture && pipeline) {
        const gl = ctx.gl
        gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo)
        gl.viewport(0, 0, out.width, out.height)
        gl.useProgram(pipeline.program)
        gl.bindVertexArray(pipeline.vao)
        bindTexture(gl, 0, input.texture, pipeline.uniforms['u_input'] ?? null)
        gl.uniform1f(pipeline.uniforms['u_strength'] ?? null, strength)
        gl.uniform1f(pipeline.uniforms['u_count'] ?? null, palette.length)
        for (let i = 0; i < 8; i++) {
          const color = palette[i] ?? palette[palette.length - 1] ?? DEFAULT_PALETTE[DEFAULT_PALETTE.length - 1]!
          gl.uniform3f(pipeline.uniforms[`u_palette[${i}]`] ?? null, color[0] / 255, color[1] / 255, color[2] / 255)
        }
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
          if (mode === 'curves' && curves) {
            const cr = sampleCurve(curves.r, r)
            const cg = sampleCurve(curves.g, g)
            const cb = sampleCurve(curves.b, b)
            dst[i] = Math.round(lerp(r, cr, strength))
            dst[i + 1] = Math.round(lerp(g, cg, strength))
            dst[i + 2] = Math.round(lerp(b, cb, strength))
          } else {
            const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
            const [lr, lg, lb] = gradeSample(lum, palette)
            dst[i] = Math.round(lerp(r, lr, strength))
            dst[i + 1] = Math.round(lerp(g, lg, strength))
            dst[i + 2] = Math.round(lerp(b, lb, strength))
          }
          dst[i + 3] = a
        }
      }
    },
  }
}

function sampleCurve(curve: number[] | undefined, value: number): number {
  if (!curve || curve.length === 0) return value
  const idx = Math.max(0, Math.min(curve.length - 1, Math.round((value / 255) * (curve.length - 1))))
  const sample = curve[idx]
  if (typeof sample !== 'number' || !Number.isFinite(sample)) return value
  return Math.max(0, Math.min(255, Math.round(sample)))
}
