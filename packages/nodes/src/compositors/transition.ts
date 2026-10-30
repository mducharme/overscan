import { bindEdgeTransform, bindTexture, createFullscreenPipeline, EDGE_TRANSFORM_GLSL, type FullscreenPipeline } from '../webgl/fullscreen.js'
import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type Compositor,
  type CompositorInputMeta,
  type FrameBuffer,
  type NodeContext,
  type RocketInterpolation,
  type Signal,
} from '@overscan/types'
import { createInputSampler } from './blend-utils.js'

export interface TransitionConfig {
  mode?: 'dissolve' | 'wipe-left' | 'wipe-right' | 'wipe-up' | 'wipe-down' | 'zoom-out' | 'flash' | 'iris'
  progress?: AnimatableFloat
  easing?: RocketInterpolation
  flashColor?: string
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t)
}

function cubicIn(t: number): number {
  return t * t * t
}

function cubicOut(t: number): number {
  const u = 1 - t
  return 1 - u * u * u
}

function cubicInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function elastic(t: number): number {
  if (t === 0 || t === 1) return t
  const p = 0.3
  const s = p / 4
  return Math.pow(2, -10 * t) * Math.sin(((t - s) * (Math.PI * 2)) / p) + 1
}

function bounce(t: number): number {
  const n1 = 7.5625
  const d1 = 2.75
  if (t < 1 / d1) return n1 * t * t
  if (t < 2 / d1) return n1 * (t - 1.5 / d1) * (t - 1.5 / d1) + 0.75
  if (t < 2.5 / d1) return n1 * (t - 2.25 / d1) * (t - 2.25 / d1) + 0.9375
  return n1 * (t - 2.625 / d1) * (t - 2.625 / d1) + 0.984375
}

function back(t: number): number {
  const c1 = 1.70158
  const c3 = c1 + 1
  return c3 * t * t * t - c1 * t * t
}

function expoIn(t: number): number {
  return t === 0 ? 0 : Math.pow(2, 10 * t - 10)
}

function expoOut(t: number): number {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t)
}

function easeValue(t: number, mode: RocketInterpolation): number {
  const x = Math.min(1, Math.max(0, t))
  switch (mode) {
    case 'step': return 0
    case 'linear': return x
    case 'smooth': return smoothstep(x)
    case 'ease-in': return cubicIn(x)
    case 'ease-out': return cubicOut(x)
    case 'ease-in-out': return cubicInOut(x)
    case 'elastic': return elastic(x)
    case 'bounce': return bounce(x)
    case 'back': return back(x)
    case 'expo-in': return expoIn(x)
    case 'expo-out': return expoOut(x)
    default: return x
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const s = hex.replace('#', '')
  const n = parseInt(s.length === 3 ? s.split('').map(c => c + c).join('') : s, 16)
  return [
    Number.isFinite(n) ? (n >> 16) & 0xff : 255,
    Number.isFinite(n) ? (n >> 8) & 0xff : 255,
    Number.isFinite(n) ? n & 0xff : 255,
  ]
}

function transitionMix(
  mode: NonNullable<TransitionConfig['mode']>,
  p: number,
  uvx: number,
  uvy: number,
): number {
  switch (mode) {
    case 'wipe-left':
      return uvx <= p ? 1 : 0
    case 'wipe-right':
      return uvx >= 1 - p ? 1 : 0
    case 'wipe-up':
      return uvy <= p ? 1 : 0
    case 'wipe-down':
      return uvy >= 1 - p ? 1 : 0
    case 'zoom-out': {
      const scale = Math.max(0.001, 1 - p * 0.85)
      const dx = (uvx - 0.5) / scale
      const dy = (uvy - 0.5) / scale
      return Math.abs(dx) <= 0.5 && Math.abs(dy) <= 0.5 ? p : 0
    }
    case 'iris': {
      const dx = uvx - 0.5
      const dy = uvy - 0.5
      return Math.sqrt(dx * dx + dy * dy) <= p * 0.75 ? 1 : 0
    }
    case 'flash':
    case 'dissolve':
    default:
      return p
  }
}

export function TransitionCompositor(config: Partial<TransitionConfig> = {}): Compositor {
  const mode = config.mode ?? 'dissolve'
  const progressRef = config.progress ?? 0
  const easing = config.easing ?? 'smooth'
  const flashColor = hexToRgb(config.flashColor ?? '#ffffff')
  let pipeline: FullscreenPipeline | null = null

  function ensureGpu(ctx: NodeContext): void {
    const gl = ctx.gl
    if (!gl || pipeline) return
    pipeline = createFullscreenPipeline(gl, `#version 300 es
precision mediump float;
uniform sampler2D u_base;
uniform sampler2D u_overlay;
uniform sampler2D u_mask;
uniform float u_progress;
uniform float u_mode;
uniform float u_useMask;
uniform vec3 u_flashColor;
uniform vec2 u_basePos;
uniform vec2 u_baseScale;
uniform float u_baseRot;
uniform float u_baseEnabled;
uniform vec2 u_overlayPos;
uniform vec2 u_overlayScale;
uniform float u_overlayRot;
uniform float u_overlayEnabled;
uniform vec2 u_maskPos;
uniform vec2 u_maskScale;
uniform float u_maskRot;
uniform float u_maskEnabled;
in vec2 v_uv;
out vec4 fragColor;
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
${EDGE_TRANSFORM_GLSL}
float mixForMode(float mode, float p, vec2 uv) {
  if (mode < 0.5) return p;
  if (mode < 1.5) return uv.x <= p ? 1.0 : 0.0;
  if (mode < 2.5) return uv.x >= 1.0 - p ? 1.0 : 0.0;
  if (mode < 3.5) return uv.y <= p ? 1.0 : 0.0;
  if (mode < 4.5) return uv.y >= 1.0 - p ? 1.0 : 0.0;
  if (mode < 5.5) {
    float scale = max(0.001, 1.0 - p * 0.85);
    vec2 d = (uv - 0.5) / scale;
    return abs(d.x) <= 0.5 && abs(d.y) <= 0.5 ? p : 0.0;
  }
  if (mode < 6.5) return p;
  vec2 c = uv - 0.5;
  return length(c) <= p * 0.75 ? 1.0 : 0.0;
}
void main() {
  vec2 baseUv = applyEdgeTransform(v_uv, u_basePos, u_baseScale, u_baseRot, u_baseEnabled);
  vec2 overUv = applyEdgeTransform(v_uv, u_overlayPos, u_overlayScale, u_overlayRot, u_overlayEnabled);
  vec4 base = edgeTransformInside(v_uv, u_basePos, u_baseScale, u_baseRot, u_baseEnabled) ? texture(u_base, baseUv) : vec4(0.0);
  vec4 over = edgeTransformInside(v_uv, u_overlayPos, u_overlayScale, u_overlayRot, u_overlayEnabled) ? texture(u_overlay, overUv) : vec4(0.0);
  float mask = u_useMask > 0.5
    ? (edgeTransformInside(v_uv, u_maskPos, u_maskScale, u_maskRot, u_maskEnabled)
      ? luma(texture(u_mask, applyEdgeTransform(v_uv, u_maskPos, u_maskScale, u_maskRot, u_maskEnabled)).rgb)
      : 0.0)
    : 1.0;
  float k = mixForMode(u_mode, u_progress, v_uv) * mask;
  vec4 mixed = vec4(mix(base.rgb, over.rgb, k), mix(base.a, over.a, k));
  if (u_mode > 5.5 && u_mode < 6.5) {
    float flash = sin(min(1.0, u_progress) * 3.14159);
    mixed.rgb = mix(mixed.rgb, u_flashColor, flash * 0.75);
  }
  fragColor = mixed;
}`, [
      'u_base', 'u_overlay', 'u_mask', 'u_progress', 'u_mode', 'u_useMask', 'u_flashColor',
      'u_basePos', 'u_baseScale', 'u_baseRot', 'u_baseEnabled',
      'u_overlayPos', 'u_overlayScale', 'u_overlayRot', 'u_overlayEnabled',
      'u_maskPos', 'u_maskScale', 'u_maskRot', 'u_maskEnabled',
    ])
  }

  return {
    type: 'compositor',
    id: 'transition',
    inputs: ['base', 'overlay', 'mask'],
    mode: 'alpha',
    opacity: 1,
    glsl: 'gpu-transition',
    config: config,
    init(ctx: NodeContext) { ensureGpu(ctx) },
    destroy() { pipeline = null },
    compose(
      ctx: NodeContext,
      inputs: Readonly<Record<string, FrameBuffer>>,
      out: FrameBuffer,
      signal: Signal,
      inputMeta?: Readonly<Record<string, CompositorInputMeta>>,
    ): void {
      const base = inputs['base']
      const overlay = inputs['overlay']
      if (!base || !overlay) return
      const maskBuf = inputs['mask']
      const p = easeValue(resolveAnimatableFloat(progressRef, signal), easing)
      const W = out.width
      const H = out.height

      if (ctx.gl && out.fbo && pipeline && base.texture && overlay.texture) {
        const gl = ctx.gl
        gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo)
        gl.viewport(0, 0, W, H)
        gl.useProgram(pipeline.program)
        gl.bindVertexArray(pipeline.vao)
        bindTexture(gl, 0, base.texture, pipeline.uniforms['u_base'] ?? null)
        bindTexture(gl, 1, overlay.texture, pipeline.uniforms['u_overlay'] ?? null)
        if (maskBuf?.texture) bindTexture(gl, 2, maskBuf.texture, pipeline.uniforms['u_mask'] ?? null)
        gl.uniform1f(pipeline.uniforms['u_progress'] ?? null, p)
        gl.uniform1f(pipeline.uniforms['u_mode'] ?? null, transitionModeIndex(mode))
        gl.uniform1f(pipeline.uniforms['u_useMask'] ?? null, maskBuf?.texture ? 1 : 0)
        gl.uniform3f(pipeline.uniforms['u_flashColor'] ?? null, flashColor[0] / 255, flashColor[1] / 255, flashColor[2] / 255)
        bindEdgeTransform(gl, pipeline.uniforms, 'u_base', inputMeta?.['base']?.transform)
        bindEdgeTransform(gl, pipeline.uniforms, 'u_overlay', inputMeta?.['overlay']?.transform)
        bindEdgeTransform(gl, pipeline.uniforms, 'u_mask', inputMeta?.['mask']?.transform)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        return
      }

      const sampler = createInputSampler(base, overlay, maskBuf, W, H, inputMeta)

      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const { br, bg, bb, ba, or, og, ob, oa, mask } = sampler.sample(x, y)
          const uvx = x / Math.max(1, W - 1)
          const uvy = y / Math.max(1, H - 1)
          const k = transitionMix(mode, p, uvx, uvy) * mask
          const o = (y * W + x) * 4
          let rr = Math.round(br * (1 - k) + or * k)
          let rg = Math.round(bg * (1 - k) + og * k)
          let rb = Math.round(bb * (1 - k) + ob * k)
          if (mode === 'flash') {
            const flash = Math.sin(Math.min(1, p) * Math.PI) * 0.75
            rr = Math.round(rr * (1 - flash) + flashColor[0] * flash)
            rg = Math.round(rg * (1 - flash) + flashColor[1] * flash)
            rb = Math.round(rb * (1 - flash) + flashColor[2] * flash)
          }
          out.data[o] = rr
          out.data[o + 1] = rg
          out.data[o + 2] = rb
          out.data[o + 3] = Math.round(ba * (1 - k) + oa * k)
        }
      }
    },
  }
}

function transitionModeIndex(mode: NonNullable<TransitionConfig['mode']>): number {
  switch (mode) {
    case 'wipe-left': return 1
    case 'wipe-right': return 2
    case 'wipe-up': return 3
    case 'wipe-down': return 4
    case 'zoom-out': return 5
    case 'flash': return 6
    case 'iris': return 7
    case 'dissolve':
    default: return 0
  }
}
