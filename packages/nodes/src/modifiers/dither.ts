import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Modifier,
  type NodeContext,
  type Signal,
} from '@overscan/types'
import { readPalette, type Rgb } from '../color.js'
import { createFullscreenPipeline, drawFullscreen, PIXEL_GLSL, type FullscreenPipeline } from '../webgl/fullscreen.js'

export interface DitherConfig {
  /** Fixed palette to reduce to; `levels` quantises each channel instead. */
  palette?: 'levels' | 'c64' | 'cga' | 'ega' | 'gameboy' | 'pico8' | 'mono' | 'amber' | 'custom'
  /** Colours for `palette: custom`, as `[[r, g, b], …]`. */
  colors?: number[][]
  /** Steps per channel for `palette: levels` (2 = 8 colours). */
  levels?: number
  /** Ordered (Bayer) matrix size; `none` snaps to the nearest colour without dithering. */
  matrix?: 'none' | '2x2' | '4x4' | '8x8'
  /** How far the pattern pushes each pixel before snapping (0–1); higher dithers more, lower bands more. */
  spread?: AnimatableFloat
  /** Size of one dither dot in pixels (at 640×360 the classic look is 1–2). */
  pixelSize?: number
}

const PALETTES: Record<string, Rgb[]> = {
  c64: [[0, 0, 0], [255, 255, 255], [136, 57, 50], [103, 182, 189], [139, 63, 150], [85, 160, 73], [64, 49, 141], [191, 206, 114], [139, 84, 41], [87, 66, 0], [184, 105, 98], [80, 80, 80], [120, 120, 120], [148, 224, 137], [120, 105, 196], [159, 159, 159]],
  cga: [[0, 0, 0], [85, 255, 255], [255, 85, 255], [255, 255, 255]],
  ega: [[0, 0, 0], [0, 0, 170], [0, 170, 0], [0, 170, 170], [170, 0, 0], [170, 0, 170], [170, 85, 0], [170, 170, 170], [85, 85, 85], [85, 85, 255], [85, 255, 85], [85, 255, 255], [255, 85, 85], [255, 85, 255], [255, 255, 85], [255, 255, 255]],
  gameboy: [[15, 56, 15], [48, 98, 48], [139, 172, 15], [155, 188, 15]],
  pico8: [[0, 0, 0], [29, 43, 83], [126, 37, 83], [0, 135, 81], [171, 82, 54], [95, 87, 79], [194, 195, 199], [255, 241, 232], [255, 0, 77], [255, 163, 0], [255, 236, 39], [0, 228, 54], [41, 173, 255], [131, 118, 156], [255, 119, 168], [255, 204, 170]],
  mono: [[0, 0, 0], [255, 255, 255]],
  amber: [[20, 8, 0], [120, 50, 0], [220, 120, 10], [255, 200, 80]],
}

/** Bayer threshold matrix of size n (a power of two), values in [0, 1). Built by doubling: M₂ₙ = [4M, 4M+2; 4M+3, 4M+1]. */
export function bayerMatrix(n: number): Float32Array {
  let m = [0]
  for (let size = 1; size < n; size *= 2) {
    const next = new Array<number>(size * 2 * size * 2)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = 4 * m[y * size + x]!
        next[y * size * 2 + x] = v
        next[y * size * 2 + x + size] = v + 2
        next[(y + size) * size * 2 + x] = v + 3
        next[(y + size) * size * 2 + x + size] = v + 1
      }
    }
    m = next
  }
  return Float32Array.from(m, v => (v + 0.5) / (n * n))
}

/**
 * Ordered dithering to a small fixed palette (C64, CGA, EGA, Game Boy, PICO-8…) or to a few levels
 * per channel: the oldschool look, and clean colours for terminal output.
 */
export function DitherModifier(config: Partial<DitherConfig> = {}): Modifier {
  const paletteName = config.palette ?? 'c64'
  const palette = paletteName === 'custom' ? readPalette(config.colors, PALETTES['mono']!) : PALETTES[paletteName] ?? null
  const levels = Math.max(2, Math.min(32, Math.round(config.levels ?? 3)))
  const size = config.matrix === 'none' ? 0 : config.matrix === '2x2' ? 2 : config.matrix === '8x8' ? 8 : 4
  const matrix = size ? bayerMatrix(size) : null
  const spreadRef = config.spread ?? 0.6
  const pixelSize = Math.max(1, Math.round(config.pixelSize ?? 1))
  // Nearest palette colour per 5-bit RGB cell, built once.
  const lookup = palette ? buildLookup(palette) : null
  // The GPU searches the palette per pixel (it holds up to MAX_GPU_COLORS); longer ones stay on the CPU.
  const gpuPalette = palette && palette.length <= MAX_GPU_COLORS ? palette : null
  let pipeline: FullscreenPipeline | null = null

  return {
    type: 'modifier',
    id: 'dither',
    persistent: false,
    glsl: 'gpu-dither',
    config: config,
    init(ctx: NodeContext) {
      if (ctx.gl && !pipeline && (gpuPalette || !palette)) {
        pipeline = createFullscreenPipeline(ctx.gl, DITHER_GLSL, ['u_input', 'u_size', 'u_palette[0]', 'u_count', 'u_levels', 'u_matrixSize', 'u_bayer[0]', 'u_push', 'u_pixel'])
      }
    },
    destroy() { pipeline = null },
    apply(ctx: NodeContext, input: FrameBuffer, out: FrameBuffer, signal: Signal): void {
      const { width: w, height: h } = input
      const src = input.data
      const dst = out.data
      const spread = Math.max(0, Math.min(1, resolveAnimatableFloat(spreadRef, signal)))
      // One palette step: how far apart neighbouring colours are, so the pattern can bridge them.
      const step = palette ? 255 / Math.max(1, Math.cbrt(palette.length)) : 255 / (levels - 1)
      if (ctx.gl && out.fbo && input.texture && pipeline) {
        drawFullscreen(ctx.gl, pipeline, out.fbo, w, h, input.texture, u => {
          const gl = ctx.gl!
          gl.uniform2i(u['u_size'] ?? null, w, h)
          if (gpuPalette) gl.uniform3fv(u['u_palette[0]'] ?? null, gpuPalette.flat())
          gl.uniform1i(u['u_count'] ?? null, gpuPalette?.length ?? 0)
          gl.uniform1f(u['u_levels'] ?? null, levels)
          gl.uniform1i(u['u_matrixSize'] ?? null, size)
          if (matrix) gl.uniform1fv(u['u_bayer[0]'] ?? null, matrix)
          gl.uniform1f(u['u_push'] ?? null, spread * step)
          gl.uniform1i(u['u_pixel'] ?? null, pixelSize)
        })
        return
      }
      for (let y = 0; y < h; y++) {
        const my = Math.floor(y / pixelSize)
        for (let x = 0; x < w; x++) {
          const o = (y * w + x) * 4
          const threshold = matrix ? matrix[(my % size) * size + (Math.floor(x / pixelSize) % size)]! - 0.5 : 0
          const push = threshold * spread * step
          const r = clampByte(src[o]! + push)
          const g = clampByte(src[o + 1]! + push)
          const b = clampByte(src[o + 2]! + push)
          if (lookup && palette) {
            const c = palette[lookup[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)]!]!
            dst[o] = c[0]; dst[o + 1] = c[1]; dst[o + 2] = c[2]
          } else {
            dst[o] = quantize(r, levels); dst[o + 1] = quantize(g, levels); dst[o + 2] = quantize(b, levels)
          }
          dst[o + 3] = src[o + 3]!
        }
      }
    },
  }
}

const clampByte = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v | 0)
const quantize = (v: number, levels: number): number => Math.round((Math.round((v / 255) * (levels - 1)) / (levels - 1)) * 255)

/** For every 5-bit-per-channel colour, the index of the nearest palette entry (by perceptual-ish weights). */
function buildLookup(palette: readonly Rgb[]): Uint8Array {
  const table = new Uint8Array(32 * 32 * 32)
  for (let r = 0; r < 32; r++) {
    for (let g = 0; g < 32; g++) {
      for (let b = 0; b < 32; b++) {
        const R = r * 8 + 4, G = g * 8 + 4, B = b * 8 + 4
        let best = 0
        let bestD = Infinity
        for (let i = 0; i < palette.length; i++) {
          const c = palette[i]!
          const d = 2 * (R - c[0]) ** 2 + 4 * (G - c[1]) ** 2 + 3 * (B - c[2]) ** 2
          if (d < bestD) { bestD = d; best = i }
        }
        table[(r << 10) | (g << 5) | b] = best
      }
    }
  }
  return table
}

const MAX_GPU_COLORS = 32

/** GPU twin of the CPU loop: the same thresholds, truncation and nearest colour (weights 2, 4, 3 on 5-bit cells). */
const DITHER_GLSL = `#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform ivec2 u_size;
uniform vec3 u_palette[${MAX_GPU_COLORS}];
uniform int u_count;
uniform float u_levels;
uniform int u_matrixSize;
uniform float u_bayer[64];
uniform float u_push;
uniform int u_pixel;
out vec4 fragColor;
${PIXEL_GLSL}
float quantize(float v) { return jsRound(jsRound(v / 255.0 * (u_levels - 1.0)) / (u_levels - 1.0) * 255.0); }
void main() {
  ivec2 p = pixelCoord();
  vec4 src = texelFetch(u_input, p, 0);
  vec3 c = floor(src.rgb * 255.0 + 0.5);
  float threshold = 0.0;
  if (u_matrixSize > 0) {
    ivec2 cell = (p / u_pixel) % u_matrixSize;
    threshold = u_bayer[cell.y * u_matrixSize + cell.x] - 0.5;
  }
  vec3 v = floor(clamp(c + threshold * u_push, 0.0, 255.0));
  vec3 outc;
  if (u_count > 0) {
    vec3 centre = floor(v / 8.0) * 8.0 + 4.0;
    float best = 1e20;
    for (int i = 0; i < ${MAX_GPU_COLORS}; i++) {
      if (i >= u_count) break;
      vec3 d = centre - u_palette[i];
      float dist = 2.0 * d.r * d.r + 4.0 * d.g * d.g + 3.0 * d.b * d.b;
      if (dist < best) { best = dist; outc = u_palette[i]; }
    }
  } else {
    outc = vec3(quantize(v.r), quantize(v.g), quantize(v.b));
  }
  fragColor = vec4(outc / 255.0, src.a);
}`
