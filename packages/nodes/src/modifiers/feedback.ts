import { bindTexture, createFullscreenPipeline, type FullscreenPipeline } from '../webgl/fullscreen.js'
import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Modifier,
  type NodeContext,
  type Signal,
} from '@overscan/types'

export interface FeedbackConfig {
  /** How much of the previous frame is kept (0 = none, 1 = full trail). */
  decay?: AnimatableFloat
  blendMode?: 'alpha' | 'additive'
  offsetX?: AnimatableFloat
  offsetY?: AnimatableFloat
  scale?: AnimatableFloat
}

export function FeedbackModifier(config: Partial<FeedbackConfig> = {}): Modifier {
  const decayRef = config.decay ?? 0.85
  const blendMode = config.blendMode ?? 'alpha'
  const offsetXRef = config.offsetX ?? 0
  const offsetYRef = config.offsetY ?? 0
  const scaleRef = config.scale ?? 1
  let prev: Uint8ClampedArray | null = null
  let pw = 0
  let ph = 0
  let pipeline: FullscreenPipeline | null = null
  let prevTex: WebGLTexture | null = null
  let tw = 0
  let th = 0

  function ensureGpu(ctx: NodeContext): void {
    const gl = ctx.gl
    if (!gl || pipeline) return
    pipeline = createFullscreenPipeline(gl, `#version 300 es
precision mediump float;
uniform sampler2D u_input;
uniform sampler2D u_prev;
uniform float u_decay;
uniform vec2 u_offset;
uniform float u_scale;
uniform float u_mode;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  vec2 uv = v_uv;
  vec4 src = texture(u_input, uv);
  vec2 prevUv = (uv - 0.5 - u_offset) / max(u_scale, 0.001) + 0.5;
  vec4 prv = texture(u_prev, prevUv);
  fragColor = u_mode > 0.5
    ? vec4(min(vec3(1.0), src.rgb + prv.rgb * u_decay), max(src.a, prv.a * u_decay))
    : mix(src, prv, u_decay);
}`, ['u_input', 'u_prev', 'u_decay', 'u_offset', 'u_scale', 'u_mode'])
  }

  function ensurePrevTexture(gl: WebGL2RenderingContext, width: number, height: number): void {
    if (prevTex && tw === width && th === height) return
    prevTex = gl.createTexture()
    if (!prevTex) throw new Error('FeedbackModifier: createTexture failed')
    gl.bindTexture(gl.TEXTURE_2D, prevTex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    tw = width
    th = height
  }

  return {
    type:       'modifier',
    id:         'feedback',
    persistent: true,
    glsl:       'gpu-feedback',
    config:     config as Modifier['config'],
    init:       (ctx: NodeContext) => {
      prev = null
      ensureGpu(ctx)
    },
    destroy:    () => {
      prev = null
      pipeline = null
      prevTex = null
      tw = 0
      th = 0
    },
    apply(
      ctx: NodeContext,
      input: FrameBuffer,
      out: FrameBuffer,
      signal: Signal,
    ): void {
      const decay = Math.min(1, Math.max(0, resolveAnimatableFloat(decayRef, signal)))
      const offsetX = resolveAnimatableFloat(offsetXRef, signal)
      const offsetY = resolveAnimatableFloat(offsetYRef, signal)
      const scale = Math.max(0.001, resolveAnimatableFloat(scaleRef, signal))
      if (ctx.gl && out.fbo && input.texture && pipeline) {
        const gl = ctx.gl
        ensurePrevTexture(gl, out.width, out.height)
        if (!prevTex) throw new Error('FeedbackModifier: previous texture missing')
        gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo)
        gl.viewport(0, 0, out.width, out.height)
        gl.useProgram(pipeline.program)
        gl.bindVertexArray(pipeline.vao)
        bindTexture(gl, 0, input.texture, pipeline.uniforms['u_input'] ?? null)
        bindTexture(gl, 1, prevTex, pipeline.uniforms['u_prev'] ?? null)
        gl.uniform1f(pipeline.uniforms['u_decay'] ?? null, decay)
        gl.uniform2f(pipeline.uniforms['u_offset'] ?? null, offsetX, offsetY)
        gl.uniform1f(pipeline.uniforms['u_scale'] ?? null, scale)
        gl.uniform1f(pipeline.uniforms['u_mode'] ?? null, blendMode === 'additive' ? 1 : 0)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

        gl.bindTexture(gl.TEXTURE_2D, prevTex)
        gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo)
        gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, out.width, out.height)
        return
      }
      const { width: w, height: h, data: src } = input
      const dst = out.data

      if (!prev || pw !== w || ph !== h) {
        prev = new Uint8ClampedArray(w * h * 4)
        pw = w
        ph = h
      }

      for (let i = 0; i < dst.length; i += 4) {
        const px = (i / 4) % w
        const py = Math.floor(i / 4 / w)
        const srcIdx = (py * w + px) * 4
        const prevX = Math.round(((px - w * 0.5) / scale) + w * 0.5 - offsetX * w)
        const prevY = Math.round(((py - h * 0.5) / scale) + h * 0.5 - offsetY * h)
        const samplePrev = prevX >= 0 && prevX < w && prevY >= 0 && prevY < h ? (prevY * w + prevX) * 4 : -1
        const ir = src[srcIdx] ?? 0
        const ig = src[srcIdx + 1] ?? 0
        const ib = src[srcIdx + 2] ?? 0
        const ia = src[srcIdx + 3] ?? 0
        const pr = samplePrev >= 0 ? (prev[samplePrev] ?? 0) : 0
        const pg = samplePrev >= 0 ? (prev[samplePrev + 1] ?? 0) : 0
        const pb = samplePrev >= 0 ? (prev[samplePrev + 2] ?? 0) : 0
        const pa = samplePrev >= 0 ? (prev[samplePrev + 3] ?? 0) : 0
        if (blendMode === 'additive') {
          dst[i] = Math.min(255, Math.round(ir + pr * decay))
          dst[i + 1] = Math.min(255, Math.round(ig + pg * decay))
          dst[i + 2] = Math.min(255, Math.round(ib + pb * decay))
          dst[i + 3] = Math.max(ia, Math.round(pa * decay))
        } else {
          dst[i] = Math.round(ir * (1 - decay) + pr * decay)
          dst[i + 1] = Math.round(ig * (1 - decay) + pg * decay)
          dst[i + 2] = Math.round(ib * (1 - decay) + pb * decay)
          dst[i + 3] = Math.round(ia * (1 - decay) + pa * decay)
        }
      }

      prev.set(dst)
    },
  }
}
