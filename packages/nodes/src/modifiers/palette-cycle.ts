import { bindTexture, createFullscreenPipeline, type FullscreenPipeline } from '../webgl/fullscreen.js'
import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Modifier,
  type NodeContext,
  type Signal,
} from '@overscan/types'

export interface PaletteCycleConfig {
  speed?: AnimatableFloat
  palette?: number[][]
  range?: [number, number]
  pingPong?: boolean
}

const DEFAULT_PALETTE = [
  [0, 0, 0],
  [255, 0, 128],
  [255, 200, 40],
  [255, 255, 255],
]

export function PaletteCycleModifier(config: Partial<PaletteCycleConfig> = {}): Modifier {
  const speedRef = config.speed ?? 1
  const palette = config.palette ?? DEFAULT_PALETTE
  const range = config.range ?? [0, 1]
  const pingPong = config.pingPong ?? false
  let pipeline: FullscreenPipeline | null = null

  function ensureGpu(ctx: NodeContext): void {
    const gl = ctx.gl
    if (!gl || pipeline) return
    pipeline = createFullscreenPipeline(gl, `#version 300 es
precision mediump float;
uniform sampler2D u_input;
uniform float u_offset;
uniform vec2 u_range;
uniform float u_paletteCount;
uniform vec3 u_palette[8];
in vec2 v_uv;
out vec4 fragColor;
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 samplePalette(float t) {
  float count = max(2.0, u_paletteCount);
  float scaled = clamp(t, 0.0, 1.0) * (count - 1.0);
  float idx = floor(scaled);
  float nextIdx = min(count - 1.0, idx + 1.0);
  return mix(u_palette[int(idx)], u_palette[int(nextIdx)], fract(scaled));
}
void main() {
  vec2 uv = v_uv;
  vec4 src = texture(u_input, uv);
  float y = luma(src.rgb);
  float inBand = step(u_range.x, y) * step(y, u_range.y);
  float remapped = clamp((y - u_range.x) / max(0.0001, u_range.y - u_range.x), 0.0, 1.0);
  float cycled = fract(remapped + u_offset);
  vec3 rgb = mix(src.rgb, samplePalette(cycled), inBand);
  fragColor = vec4(rgb, src.a);
}`, ['u_input', 'u_offset', 'u_range', 'u_paletteCount', 'u_palette[0]', 'u_palette[1]', 'u_palette[2]', 'u_palette[3]', 'u_palette[4]', 'u_palette[5]', 'u_palette[6]', 'u_palette[7]'])
  }

  return {
    type: 'modifier',
    id: 'palette-cycle',
    persistent: false,
    glsl: 'gpu-palette-cycle',
    config: config as Modifier['config'],
    init(ctx: NodeContext) { ensureGpu(ctx) },
    destroy() { pipeline = null },
    apply(ctx: NodeContext, input: FrameBuffer, out: FrameBuffer, signal: Signal): void {
      const speed = resolveAnimatableFloat(speedRef, signal)
      const wave = pingPong ? (Math.sin(signal.t * speed) * 0.5 + 0.5) : signal.t * speed
      const offset = ((wave % 1) + 1) % 1
      const lo = Math.max(0, Math.min(1, range[0]))
      const hi = Math.max(lo + 0.0001, Math.min(1, range[1]))
      if (ctx.gl && out.fbo && input.texture && pipeline) {
        const gl = ctx.gl
        gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo)
        gl.viewport(0, 0, out.width, out.height)
        gl.useProgram(pipeline.program)
        gl.bindVertexArray(pipeline.vao)
        bindTexture(gl, 0, input.texture, pipeline.uniforms['u_input'] ?? null)
        gl.uniform1f(pipeline.uniforms['u_offset'] ?? null, offset)
        gl.uniform2f(pipeline.uniforms['u_range'] ?? null, lo, hi)
        gl.uniform1f(pipeline.uniforms['u_paletteCount'] ?? null, Math.min(palette.length, 8))
        for (let i = 0; i < 8; i++) {
          const c = palette[i] ?? palette[palette.length - 1] ?? DEFAULT_PALETTE[DEFAULT_PALETTE.length - 1]!
          gl.uniform3f(pipeline.uniforms[`u_palette[${i}]`] ?? null, (c[0] ?? 0) / 255, (c[1] ?? 0) / 255, (c[2] ?? 0) / 255)
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
          const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
          if (lum >= lo && lum <= hi) {
            const remapped = (lum - lo) / Math.max(0.0001, hi - lo)
            // Same value as ((s % 1 + 1) % 1) for s >= 0, without float modulo (slow in V8).
            const s = remapped + offset
            const wrapped = s - Math.floor(s) + 1
            const cycled = wrapped >= 2 ? 0 : wrapped - 1
            const c = samplePalette(palette, cycled)
            dst[i] = c[0]
            dst[i + 1] = c[1]
            dst[i + 2] = c[2]
          } else {
            dst[i] = r
            dst[i + 1] = g
            dst[i + 2] = b
          }
          dst[i + 3] = a
        }
      }
    },
  }
}

function samplePalette(palette: number[][], t: number): [number, number, number] {
  const colors = palette.length > 1 ? palette : DEFAULT_PALETTE
  const scaled = Math.max(0, Math.min(1, t)) * (colors.length - 1)
  const idx = Math.min(colors.length - 2, Math.floor(scaled))
  const frac = scaled - idx
  const a = colors[idx] ?? colors[0] ?? DEFAULT_PALETTE[0]!
  const b = colors[idx + 1] ?? a
  return [
    Math.round((a[0] ?? 0) + ((b[0] ?? 0) - (a[0] ?? 0)) * frac),
    Math.round((a[1] ?? 0) + ((b[1] ?? 0) - (a[1] ?? 0)) * frac),
    Math.round((a[2] ?? 0) + ((b[2] ?? 0) - (a[2] ?? 0)) * frac),
  ]
}
