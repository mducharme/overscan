import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Modifier,
  type NodeContext,
  type Signal,
} from '@overscan/types'
import { wrap } from '../color.js'

/** Mirrored repeat: 0→1 then back 1→0, so inputs that do not tile show no seam. */
const mirror = (v: number, n: number): number => {
  const m = wrap(v, 2 * n)
  return m < n ? m : 2 * n - 1 - m
}
import { viewportMinDim } from '../viewport-scale.js'
import { createFullscreenPipeline, drawFullscreen, PIXEL_GLSL, type FullscreenPipeline } from '../webgl/fullscreen.js'

export type UvPreset = 'tunnel' | 'flower' | 'sphere' | 'twirl'

export interface UvMapConfig {
  /**
   * tunnel: the input wraps the inside of an endless tube. flower: a tunnel whose walls bulge into
   * petals. sphere: the input wraps a ball. twirl: the input itself, twisted around the centre.
   */
  preset?: UvPreset
  /** Centre, 0–1 of the frame. */
  centerX?: AnimatableFloat
  centerY?: AnimatableFloat
  zoom?: AnimatableFloat
  /** Texture scroll in repeats per second: around (u) and along/up (v). */
  speedU?: AnimatableFloat
  speedV?: AnimatableFloat
  /** Extra rotation in radians. */
  rotation?: AnimatableFloat
  /** Twirl angle at the centre (radians), or petal depth for flower (0–1). */
  amount?: AnimatableFloat
  /** Petals around a flower tunnel. */
  petals?: number
  /** Sphere and twirl radius, as a fraction of the frame's short side. */
  radius?: AnimatableFloat
  /** Darkening with depth (tunnel, flower) or lighting (sphere), 0–1. */
  shade?: AnimatableFloat
  /** How many times the input repeats around the tunnel or ball. */
  repeat?: number
}

/**
 * Texture mapping by coordinate tables: each output pixel reads the input at a computed (u, v). One
 * node covers the classic tunnel, flower tunnel, sphere mapping and twirl, applied to any input.
 */
export function UvMapModifier(config: Partial<UvMapConfig> = {}): Modifier {
  const preset = config.preset ?? 'tunnel'
  const centerXRef = config.centerX ?? 0.5
  const centerYRef = config.centerY ?? 0.5
  const zoomRef = config.zoom ?? 1
  const speedURef = config.speedU ?? (preset === 'sphere' ? 0.08 : 0)
  const speedVRef = config.speedV ?? (preset === 'tunnel' || preset === 'flower' ? 0.6 : 0)
  const rotationRef = config.rotation ?? 0
  const amountRef = config.amount ?? (preset === 'twirl' ? 3 : 0.5)
  const petals = Math.max(1, Math.round(config.petals ?? 5))
  const radiusRef = config.radius ?? (preset === 'sphere' ? 0.42 : 0.6)
  const shadeRef = config.shade ?? 0.8
  const repeat = Math.max(1, Math.round(config.repeat ?? (preset === 'sphere' ? 2 : 1)))
  // Fixed light for the sphere: up-left and towards the viewer.
  const light = normalize(-0.45, -0.55, 0.7)
  let pipeline: FullscreenPipeline | null = null

  return {
    type: 'modifier',
    id: 'uv-map',
    persistent: false,
    glsl: 'gpu-uv-map',
    config: config,
    init(ctx: NodeContext) {
      if (ctx.gl && !pipeline) {
        pipeline = createFullscreenPipeline(ctx.gl, UV_MAP_GLSL, [
          'u_input', 'u_size', 'u_preset', 'u_center', 'u_unit', 'u_zoom', 'u_scroll', 'u_rotation', 'u_amount',
          'u_petals', 'u_radius', 'u_shade', 'u_repeat', 'u_phase', 'u_light',
        ])
      }
    },
    destroy() { pipeline = null },
    apply(ctx: NodeContext, input: FrameBuffer, out: FrameBuffer, signal: Signal): void {
      const { width: w, height: h } = input
      const src = input.data
      const dst = out.data
      const unit = viewportMinDim(w, h)
      const cx = resolveAnimatableFloat(centerXRef, signal) * w
      const cy = resolveAnimatableFloat(centerYRef, signal) * h
      const zoom = Math.max(1e-3, resolveAnimatableFloat(zoomRef, signal))
      const scrollU = resolveAnimatableFloat(speedURef, signal) * signal.t
      const scrollV = resolveAnimatableFloat(speedVRef, signal) * signal.t
      const rotation = resolveAnimatableFloat(rotationRef, signal)
      const amount = resolveAnimatableFloat(amountRef, signal)
      const radius = Math.max(1e-3, resolveAnimatableFloat(radiusRef, signal))
      const shade = Math.max(0, Math.min(1, resolveAnimatableFloat(shadeRef, signal)))
      const phase = signal.t * 1.3
      if (ctx.gl && out.fbo && input.texture && pipeline) {
        drawFullscreen(ctx.gl, pipeline, out.fbo, w, h, input.texture, u => {
          const gl = ctx.gl!
          gl.uniform2i(u['u_size'] ?? null, w, h)
          gl.uniform1i(u['u_preset'] ?? null, PRESETS.indexOf(preset))
          gl.uniform2f(u['u_center'] ?? null, cx, cy)
          gl.uniform1f(u['u_unit'] ?? null, unit)
          gl.uniform1f(u['u_zoom'] ?? null, zoom)
          gl.uniform2f(u['u_scroll'] ?? null, scrollU, scrollV)
          gl.uniform1f(u['u_rotation'] ?? null, rotation)
          gl.uniform1f(u['u_amount'] ?? null, amount)
          gl.uniform1f(u['u_petals'] ?? null, petals)
          gl.uniform1f(u['u_radius'] ?? null, radius)
          gl.uniform1f(u['u_shade'] ?? null, shade)
          gl.uniform1f(u['u_repeat'] ?? null, repeat)
          gl.uniform1f(u['u_phase'] ?? null, phase)
          gl.uniform3f(u['u_light'] ?? null, light[0], light[1], light[2])
        })
        return
      }

      for (let y = 0; y < h; y++) {
        const py = (y + 0.5 - cy) / unit
        for (let x = 0; x < w; x++) {
          const px = (x + 0.5 - cx) / unit
          const o = (y * w + x) * 4
          const r = Math.sqrt(px * px + py * py)
          let sx: number
          let sy: number
          let light01 = 1
          if (preset === 'twirl') {
            // Screen-space twist: rotation grows towards the centre and fades out at the radius.
            const a = Math.atan2(py, px) + rotation + (r < radius ? amount * (1 - r / radius) ** 2 : 0)
            const rr = r / zoom
            sx = cx + Math.cos(a) * rr * unit
            sy = cy + Math.sin(a) * rr * unit
            sx = mirror(Math.floor(sx), w)
            sy = mirror(Math.floor(sy), h)
          } else if (preset === 'sphere') {
            if (r >= radius) {
              dst[o] = 0; dst[o + 1] = 0; dst[o + 2] = 0; dst[o + 3] = 0
              continue
            }
            const nx = px / radius
            const ny = py / radius
            const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny))
            const lon = Math.atan2(nx, nz) + rotation
            const lat = Math.asin(Math.max(-1, Math.min(1, ny)))
            const u = (lon / (Math.PI * 2)) * repeat / zoom + scrollU
            const v = (lat / Math.PI + 0.5) * repeat / zoom + scrollV
            sx = mirror(Math.floor(u * w), w)
            sy = mirror(Math.floor(v * h), h)
            const diffuse = Math.max(0, nx * light[0] + ny * light[1] + nz * light[2])
            light01 = 1 - shade + shade * (0.15 + 0.95 * diffuse)
            // Specular highlight, added below as white.
            const spec = shade * Math.pow(diffuse, 24) * 0.6
            const s = (sy * w + sx) * 4
            dst[o] = Math.min(255, src[s]! * light01 + spec * 255)
            dst[o + 1] = Math.min(255, src[s + 1]! * light01 + spec * 255)
            dst[o + 2] = Math.min(255, src[s + 2]! * light01 + spec * 255)
            // Soft rim so the ball's edge is not jagged.
            dst[o + 3] = Math.min(1, (radius - r) * unit) * src[s + 3]!
            continue
          } else {
            // Tunnel and flower: angle around the tube, depth from the distance to the centre.
            const a = Math.atan2(py, px) + rotation
            const wall = preset === 'flower' ? 1 + amount * 0.6 * Math.sin(petals * a + phase) : 1
            const depth = (0.3 * zoom) / Math.max(1e-3, r * wall)
            const u = (a / (Math.PI * 2)) * repeat + scrollU
            const v = depth + scrollV
            sx = mirror(Math.floor(u * w), w)
            sy = mirror(Math.floor(v * h), h)
            light01 = 1 - shade + shade * Math.min(1, r * wall * 2.4)
          }
          const s = (sy * w + sx) * 4
          dst[o] = src[s]! * light01
          dst[o + 1] = src[s + 1]! * light01
          dst[o + 2] = src[s + 2]! * light01
          dst[o + 3] = src[s + 3]!
        }
      }
    },
  }
}

function normalize(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z) || 1
  return [x / l, y / l, z / l]
}

const PRESETS: readonly UvPreset[] = ['tunnel', 'flower', 'sphere', 'twirl']

/** GPU twin of the CPU loop: the same mappings, mirrored repeat and shading per preset. */
const UV_MAP_GLSL = `#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform ivec2 u_size;
uniform int u_preset;
uniform vec2 u_center;
uniform float u_unit;
uniform float u_zoom;
uniform vec2 u_scroll;
uniform float u_rotation;
uniform float u_amount;
uniform float u_petals;
uniform float u_radius;
uniform float u_shade;
uniform float u_repeat;
uniform float u_phase;
uniform vec3 u_light;
out vec4 fragColor;
${PIXEL_GLSL}
const float TAU = 6.283185307179586;
const float PI = 3.141592653589793;
// Mirrored repeat (0→n−1 then back), so inputs that do not tile show no seam.
int mirrorInt(float v, int n) {
  int m = int(mod(v, float(2 * n)));
  return m < n ? m : 2 * n - 1 - m;
}
vec4 at(float x, float y) {
  return texelFetch(u_input, ivec2(mirrorInt(floor(x), u_size.x), mirrorInt(floor(y), u_size.y)), 0);
}
void main() {
  vec2 p = (gl_FragCoord.xy - u_center) / u_unit;
  float r = length(p);
  vec2 size = vec2(u_size);
  if (u_preset == 3) {
    // Twirl: rotation grows towards the centre and fades out at the radius.
    float a = atan(p.y, p.x) + u_rotation + (r < u_radius ? u_amount * pow(1.0 - r / u_radius, 2.0) : 0.0);
    float rr = r / u_zoom;
    fragColor = at(u_center.x + cos(a) * rr * u_unit, u_center.y + sin(a) * rr * u_unit);
    return;
  }
  if (u_preset == 2) {
    if (r >= u_radius) { fragColor = vec4(0.0); return; }
    vec2 n2 = p / u_radius;
    float nz = sqrt(max(0.0, 1.0 - dot(n2, n2)));
    float lon = atan(n2.x, nz) + u_rotation;
    float lat = asin(clamp(n2.y, -1.0, 1.0));
    float u = lon / TAU * u_repeat / u_zoom + u_scroll.x;
    float v = (lat / PI + 0.5) * u_repeat / u_zoom + u_scroll.y;
    vec4 c = at(u * size.x, v * size.y);
    float diffuse = max(0.0, dot(vec3(n2, nz), u_light));
    float light = 1.0 - u_shade + u_shade * (0.15 + 0.95 * diffuse);
    float spec = u_shade * pow(diffuse, 24.0) * 0.6;
    // Soft rim so the ball's edge is not jagged.
    fragColor = vec4(min(vec3(1.0), c.rgb * light + spec), min(1.0, (u_radius - r) * u_unit) * c.a);
    return;
  }
  // Tunnel and flower: angle around the tube, depth from the distance to the centre.
  float a = atan(p.y, p.x) + u_rotation;
  float wall = u_preset == 1 ? 1.0 + u_amount * 0.6 * sin(u_petals * a + u_phase) : 1.0;
  float depth = 0.3 * u_zoom / max(1e-3, r * wall);
  vec4 c = at((a / TAU * u_repeat + u_scroll.x) * size.x, (depth + u_scroll.y) * size.y);
  float light = 1.0 - u_shade + u_shade * min(1.0, r * wall * 2.4);
  fragColor = vec4(c.rgb * light, c.a);
}`
