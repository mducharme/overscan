import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Modifier,
  type NodeContext,
  type Signal,
} from '@overscan/types'
import { hexToRgb } from '../color.js'
import { scaleThickness, viewportMinDim } from '../viewport-scale.js'
import { bindTexture, createFullscreenPipeline, drawFullscreen, ensureRenderTarget, PIXEL_GLSL, type FullscreenPipeline, type RenderTarget } from '../webgl/fullscreen.js'

export interface BumpConfig {
  /** Light position, 0–1 of the frame. Unset: the light circles the centre. */
  lightX?: AnimatableFloat
  lightY?: AnimatableFloat
  /** Size of the light's pool, as a fraction of the frame's short side. */
  radius?: AnimatableFloat
  /** How strongly the input's brightness tilts the surface. */
  depth?: AnimatableFloat
  /** light: the light's colour on a grey surface. surface: the input's own colours, lit. */
  color?: 'light' | 'surface'
  lightColor?: string
  /** Light that reaches the whole surface, 0–1. */
  ambient?: AnimatableFloat
  /** Blur of the height map in pixels (at 640×360): rounder, smoother relief. */
  soften?: number
}

/**
 * 2D bump mapping: the input's brightness is a height map (a logo works well), lit by a moving point
 * light. Slopes facing the light catch it, the rest falls into shadow.
 */
export function BumpModifier(config: Partial<BumpConfig> = {}): Modifier {
  const lightXRef = config.lightX
  const lightYRef = config.lightY
  const radiusRef = config.radius ?? 0.8
  const depthRef = config.depth ?? 4
  const colorMode = config.color ?? 'light'
  const lightColor = hexToRgb(config.lightColor ?? '#ffe6b0', [255, 230, 176])
  const ambientRef = config.ambient ?? 0.12
  const soften = Math.max(0, config.soften ?? 3)
  let height = new Float32Array(0)
  let scratch = new Float32Array(0)
  let gpu: { height: FullscreenPipeline; blur: FullscreenPipeline; light: FullscreenPipeline } | null = null
  let targets: [RenderTarget | null, RenderTarget | null] = [null, null]

  /** Light the input on the GPU: height map, its blur (two box passes per axis, as on the CPU), lighting. */
  function applyGpu(gl: WebGL2RenderingContext, passes: NonNullable<typeof gpu>, input: FrameBuffer, out: FrameBuffer, blur: number, light: LightUniforms): void {
    const { width: w, height: h } = input
    const a = ensureRenderTarget(gl, targets[0], w, h)
    const b = ensureRenderTarget(gl, targets[1], w, h)
    targets = [a, b]
    drawFullscreen(gl, passes.height, a.fbo, w, h, input.texture!, () => {})
    if (blur > 0) {
      for (const dir of [[1, 0], [1, 0], [0, 1], [0, 1]] as const) {
        const [from, to] = targets as [RenderTarget, RenderTarget]
        drawFullscreen(gl, passes.blur, to.fbo, w, h, from.texture, u => {
          gl.uniform2i(u['u_size'] ?? null, w, h)
          gl.uniform2i(u['u_dir'] ?? null, dir[0], dir[1])
          gl.uniform1i(u['u_radius'] ?? null, blur)
        })
        targets = [to, from]
      }
    }
    drawFullscreen(gl, passes.light, out.fbo!, w, h, targets[0]!.texture, u => {
      bindTexture(gl, 1, input.texture!, u['u_src'] ?? null)
      gl.uniform2i(u['u_size'] ?? null, w, h)
      gl.uniform2f(u['u_light'] ?? null, light.lx, light.ly)
      gl.uniform1f(u['u_lz'] ?? null, light.lz)
      gl.uniform1f(u['u_radius'] ?? null, light.radius)
      gl.uniform1f(u['u_depth'] ?? null, light.depth)
      gl.uniform1f(u['u_ambient'] ?? null, light.ambient)
      gl.uniform1i(u['u_surface'] ?? null, colorMode === 'surface' ? 1 : 0)
      gl.uniform3f(u['u_lightColor'] ?? null, lightColor[0] / 255, lightColor[1] / 255, lightColor[2] / 255)
    })
  }

  return {
    type: 'modifier',
    id: 'bump',
    persistent: false,
    glsl: 'gpu-bump',
    config: config,
    init(ctx: NodeContext) {
      const gl = ctx.gl
      if (!gl || gpu) return
      gpu = {
        height: createFullscreenPipeline(gl, BUMP_HEIGHT_GLSL, ['u_input']),
        blur: createFullscreenPipeline(gl, BUMP_BLUR_GLSL, ['u_input', 'u_size', 'u_dir', 'u_radius']),
        light: createFullscreenPipeline(gl, BUMP_LIGHT_GLSL, ['u_input', 'u_src', 'u_size', 'u_light', 'u_lz', 'u_radius', 'u_depth', 'u_ambient', 'u_surface', 'u_lightColor']),
      }
    },
    destroy() {
      gpu = null
      targets = [null, null]
    },
    apply(ctx: NodeContext, input: FrameBuffer, out: FrameBuffer, signal: Signal): void {
      const { width: w, height: h } = input
      const src = input.data
      const dst = out.data
      const blurRadius = Math.round(scaleThickness(soften, w, h))
      // The GPU blur takes radii up to MAX_GPU_BLUR; a softer relief at a large size stays on the CPU.
      if (ctx.gl && out.fbo && input.texture && gpu && blurRadius <= MAX_GPU_BLUR) {
        const unit = viewportMinDim(w, h)
        const t = signal.t
        applyGpu(ctx.gl, gpu, input, out, blurRadius, {
          lx: (lightXRef !== undefined ? resolveAnimatableFloat(lightXRef, signal) : 0.5 + 0.32 * Math.cos(t * 1.1)) * w,
          ly: (lightYRef !== undefined ? resolveAnimatableFloat(lightYRef, signal) : 0.5 + 0.3 * Math.sin(t * 1.7)) * h,
          lz: unit * 0.22,
          radius: Math.max(1, resolveAnimatableFloat(radiusRef, signal) * unit),
          depth: resolveAnimatableFloat(depthRef, signal) * 6 * (unit / 360),
          ambient: Math.max(0, Math.min(1, resolveAnimatableFloat(ambientRef, signal))),
        })
        return
      }
      if (height.length !== w * h) height = new Float32Array(w * h)
      for (let i = 0, p = 0; i < w * h; i++, p += 4) {
        height[i] = ((src[p]! * 0.299 + src[p + 1]! * 0.587 + src[p + 2]! * 0.114) / 255) * (src[p + 3]! / 255)
      }
      const blur = blurRadius
      if (blur > 0) {
        if (scratch.length !== w * h) scratch = new Float32Array(w * h)
        boxBlur(height, scratch, w, h, blur)
        boxBlur(height, scratch, w, h, blur)
      }
      const t = signal.t
      const lx = (lightXRef !== undefined ? resolveAnimatableFloat(lightXRef, signal) : 0.5 + 0.32 * Math.cos(t * 1.1)) * w
      const ly = (lightYRef !== undefined ? resolveAnimatableFloat(lightYRef, signal) : 0.5 + 0.3 * Math.sin(t * 1.7)) * h
      const unit = viewportMinDim(w, h)
      const radius = Math.max(1, resolveAnimatableFloat(radiusRef, signal) * unit)
      // Slope gain: a blurred edge (a height change spread over a few pixels) tilts the surface steeply.
      const depth = resolveAnimatableFloat(depthRef, signal) * 6 * (unit / 360)
      const ambient = Math.max(0, Math.min(1, resolveAnimatableFloat(ambientRef, signal)))
      // The light hovers above the surface.
      const lz = unit * 0.22
      for (let y = 0; y < h; y++) {
        const up = (y > 0 ? y - 1 : y) * w
        const down = (y < h - 1 ? y + 1 : y) * w
        for (let x = 0; x < w; x++) {
          const i = y * w + x
          const sx = (height[i + (x < w - 1 ? 1 : 0)]! - height[i - (x > 0 ? 1 : 0)]!) * depth
          const sy = (height[down + x]! - height[up + x]!) * depth
          // Surface normal from the slopes, light direction from this point to the light.
          const nl = 1 / Math.sqrt(sx * sx + sy * sy + 1)
          const dx = lx - x, dy = ly - y
          const dist = Math.sqrt(dx * dx + dy * dy + lz * lz)
          const diffuse = Math.max(0, (-sx * dx - sy * dy + lz) * nl / dist)
          const fall = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / radius)
          const lit = ambient + (1 - ambient) * diffuse * fall
          const glint = Math.pow(diffuse, 24) * fall * 200
          const o = i * 4
          if (colorMode === 'surface') {
            dst[o] = src[o]! * lit * 1.5 + glint
            dst[o + 1] = src[o + 1]! * lit * 1.5 + glint
            dst[o + 2] = src[o + 2]! * lit * 1.5 + glint
          } else {
            const shade = lit * (0.55 + 0.45 * height[i]!)
            dst[o] = lightColor[0] * shade + glint
            dst[o + 1] = lightColor[1] * shade + glint
            dst[o + 2] = lightColor[2] * shade + glint
          }
          dst[o + 3] = 255
        }
      }
    },
  }
}

/** Separable box blur of a single-channel map, in place (`tmp` is scratch space of the same size). */
function boxBlur(map: Float32Array, tmp: Float32Array, w: number, h: number, r: number): void {
  const span = 2 * r + 1
  for (let y = 0; y < h; y++) {
    let sum = 0
    const row = y * w
    for (let x = -r; x <= r; x++) sum += map[row + Math.min(w - 1, Math.max(0, x))]!
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / span
      sum += map[row + Math.min(w - 1, x + r + 1)]! - map[row + Math.max(0, x - r)]!
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0
    for (let y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]!
    for (let y = 0; y < h; y++) {
      map[y * w + x] = sum / span
      sum += tmp[Math.min(h - 1, y + r + 1) * w + x]! - tmp[Math.max(0, y - r) * w + x]!
    }
  }
}

const MAX_GPU_BLUR = 32

interface LightUniforms {
  lx: number
  ly: number
  lz: number
  radius: number
  depth: number
  ambient: number
}

/** Heights are packed into two 8-bit channels (whole 255ths and the fraction), so slopes do not band. */
const HEIGHT_CODEC_GLSL = `
vec4 encodeHeight(float h) { float v = clamp(h, 0.0, 1.0) * 255.0; return vec4(floor(v) / 255.0, fract(v), 0.0, 1.0); }
float decodeHeight(vec4 c) { return (floor(c.r * 255.0 + 0.5) + c.g) / 255.0; }
`

const BUMP_HEIGHT_GLSL = `#version 300 es
precision highp float;
uniform sampler2D u_input;
out vec4 fragColor;
${HEIGHT_CODEC_GLSL}
void main() {
  vec4 c = texelFetch(u_input, ivec2(gl_FragCoord.xy), 0);
  fragColor = encodeHeight(dot(c.rgb, vec3(0.299, 0.587, 0.114)) * c.a);
}`

/** One box-blur pass along `u_dir`, clamped at the edges like the CPU's running sum. */
const BUMP_BLUR_GLSL = `#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform ivec2 u_size;
uniform ivec2 u_dir;
uniform int u_radius;
out vec4 fragColor;
${PIXEL_GLSL}
${HEIGHT_CODEC_GLSL}
void main() {
  ivec2 p = pixelCoord();
  float sum = 0.0;
  for (int k = -${MAX_GPU_BLUR}; k <= ${MAX_GPU_BLUR}; k++) {
    if (k < -u_radius || k > u_radius) continue;
    sum += decodeHeight(texel(u_input, p + u_dir * k, u_size));
  }
  fragColor = encodeHeight(sum / float(2 * u_radius + 1));
}`

const BUMP_LIGHT_GLSL = `#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform sampler2D u_src;
uniform ivec2 u_size;
uniform vec2 u_light;
uniform float u_lz;
uniform float u_radius;
uniform float u_depth;
uniform float u_ambient;
uniform int u_surface;
uniform vec3 u_lightColor;
out vec4 fragColor;
${PIXEL_GLSL}
${HEIGHT_CODEC_GLSL}
float heightAt(ivec2 p) { return decodeHeight(texel(u_input, p, u_size)); }
void main() {
  ivec2 p = pixelCoord();
  float sx = (heightAt(p + ivec2(1, 0)) - heightAt(p - ivec2(1, 0))) * u_depth;
  float sy = (heightAt(p + ivec2(0, 1)) - heightAt(p - ivec2(0, 1))) * u_depth;
  // Surface normal from the slopes, light direction from this point to the light.
  float nl = 1.0 / sqrt(sx * sx + sy * sy + 1.0);
  vec2 d = u_light - vec2(p);
  float dist = sqrt(dot(d, d) + u_lz * u_lz);
  float diffuse = max(0.0, (-sx * d.x - sy * d.y + u_lz) * nl / dist);
  float fall = max(0.0, 1.0 - length(d) / u_radius);
  float lit = u_ambient + (1.0 - u_ambient) * diffuse * fall;
  float glint = pow(diffuse, 24.0) * fall * 200.0 / 255.0;
  vec3 col = u_surface == 1
    ? texelFetch(u_src, p, 0).rgb * lit * 1.5 + glint
    : u_lightColor * lit * (0.55 + 0.45 * heightAt(p)) + glint;
  fragColor = vec4(min(col, vec3(1.0)), 1.0);
}`
