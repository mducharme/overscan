import { bindTexture, createFullscreenPipeline, type FullscreenPipeline } from '../webgl/fullscreen.js'
import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Modifier,
  type NodeContext,
  type Signal,
} from '@overscan/types'

export interface LensConfig {
  strength?: AnimatableFloat
  radius?: AnimatableFloat
  zoom?: AnimatableFloat
  centerX?: AnimatableFloat
  centerY?: AnimatableFloat
  chroma?: AnimatableFloat
}

export function LensModifier(config: Partial<LensConfig> = {}): Modifier {
  const strengthRef = config.strength ?? 0.22
  const radiusRef = config.radius ?? 0.32
  const zoomRef = config.zoom ?? 1.2
  const centerXRef = config.centerX ?? 0.5
  const centerYRef = config.centerY ?? 0.5
  const chromaRef = config.chroma ?? 0
  let pipeline: FullscreenPipeline | null = null

  function ensureGpu(ctx: NodeContext): void {
    const gl = ctx.gl
    if (!gl || pipeline) return
    pipeline = createFullscreenPipeline(gl, `#version 300 es
precision mediump float;
uniform sampler2D u_input;
uniform vec2 u_center;
uniform float u_strength;
uniform float u_radius;
uniform float u_zoom;
uniform float u_chroma;
in vec2 v_uv;
out vec4 fragColor;
vec2 lensUv(vec2 uv) {
  vec2 delta = uv - u_center;
  float dist = length(delta);
  if (dist > u_radius) return uv;
  float t = 1.0 - dist / max(u_radius, 0.0001);
  float curve = t * t * (3.0 - 2.0 * t);
  vec2 warped = u_center + delta / max(mix(1.0, u_zoom, curve * u_strength), 0.0001);
  return clamp(warped, vec2(0.0), vec2(1.0));
}
void main() {
  vec2 baseUv = lensUv(v_uv);
  vec2 dir = normalize(v_uv - u_center + vec2(1e-6));
  float shift = u_chroma * 0.003;
  float r = texture(u_input, clamp(baseUv + dir * shift, vec2(0.0), vec2(1.0))).r;
  float g = texture(u_input, baseUv).g;
  float b = texture(u_input, clamp(baseUv - dir * shift, vec2(0.0), vec2(1.0))).b;
  float a = texture(u_input, baseUv).a;
  fragColor = vec4(r, g, b, a);
}`, ['u_input', 'u_center', 'u_strength', 'u_radius', 'u_zoom', 'u_chroma'])
  }

  return {
    type: 'modifier',
    id: 'lens',
    persistent: false,
    config: config as Modifier['config'],
    init(ctx) { ensureGpu(ctx) },
    destroy() { pipeline = null },
    apply(ctx: NodeContext, input: FrameBuffer, out: FrameBuffer, signal: Signal): void {
      const strength = Math.max(0, resolveAnimatableFloat(strengthRef, signal))
      const radius = Math.max(0.05, Math.min(1, resolveAnimatableFloat(radiusRef, signal)))
      const zoom = Math.max(0.2, resolveAnimatableFloat(zoomRef, signal))
      const centerX = Math.max(0, Math.min(1, resolveAnimatableFloat(centerXRef, signal)))
      const centerY = Math.max(0, Math.min(1, resolveAnimatableFloat(centerYRef, signal)))
      const chroma = Math.max(0, resolveAnimatableFloat(chromaRef, signal))
      if (ctx.gl && out.fbo && input.texture && pipeline) {
        const gl = ctx.gl
        gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo)
        gl.viewport(0, 0, out.width, out.height)
        gl.useProgram(pipeline.program)
        gl.bindVertexArray(pipeline.vao)
        bindTexture(gl, 0, input.texture, pipeline.uniforms['u_input'] ?? null)
        gl.uniform2f(pipeline.uniforms['u_center'] ?? null, centerX, centerY)
        gl.uniform1f(pipeline.uniforms['u_strength'] ?? null, strength)
        gl.uniform1f(pipeline.uniforms['u_radius'] ?? null, radius)
        gl.uniform1f(pipeline.uniforms['u_zoom'] ?? null, zoom)
        gl.uniform1f(pipeline.uniforms['u_chroma'] ?? null, chroma)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        return
      }

      const { width: w, height: h, data: src } = input
      const dst = out.data
      const shift = chroma * 0.003
      const lens = lensScratch
      for (let y = 0; y < h; y++) {
        const uvy = y / Math.max(1, h - 1)
        for (let x = 0; x < w; x++) {
          const uvx = x / Math.max(1, w - 1)
          lensSample(uvx, uvy, centerX, centerY, strength, radius, zoom, lens)
          const sx = lens[0]
          const sy = lens[1]
          const dx = lens[2]
          const dy = lens[3]
          const ri = samplePixel(src, w, h, sx + dx * shift, sy + dy * shift)
          const gi = samplePixel(src, w, h, sx, sy)
          const bi = samplePixel(src, w, h, sx - dx * shift, sy - dy * shift)
          const di = (y * w + x) * 4
          dst[di] = src[ri] ?? 0
          dst[di + 1] = src[gi + 1] ?? 0
          dst[di + 2] = src[bi + 2] ?? 0
          dst[di + 3] = src[gi + 3] ?? 255
        }
      }
    },
  }
}

const lensScratch: [number, number, number, number] = [0, 0, 0, 0]

/** Writes [sourceU, sourceV, dirX, dirY] into `out`. */
function lensSample(
  uvx: number,
  uvy: number,
  centerX: number,
  centerY: number,
  strength: number,
  radius: number,
  zoom: number,
  out: [number, number, number, number],
): void {
  const deltaX = uvx - centerX
  const deltaY = uvy - centerY
  const dist = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
  const dirX = dist > 1e-6 ? deltaX / dist : 1
  const dirY = dist > 1e-6 ? deltaY / dist : 0
  out[2] = dirX
  out[3] = dirY
  if (dist > radius) {
    out[0] = uvx
    out[1] = uvy
    return
  }
  const t = 1 - dist / Math.max(radius, 1e-6)
  const curve = t * t * (3 - 2 * t)
  const scale = Math.max(1e-6, 1 + (zoom - 1) * curve * strength)
  out[0] = Math.max(0, Math.min(1, centerX + deltaX / scale))
  out[1] = Math.max(0, Math.min(1, centerY + deltaY / scale))
}

function samplePixel(data: Uint8ClampedArray, w: number, h: number, uvx: number, uvy: number): number {
  const x = Math.max(0, Math.min(w - 1, Math.round(uvx * (w - 1))))
  const y = Math.max(0, Math.min(h - 1, Math.round(uvy * (h - 1))))
  return (y * w + x) * 4
}
