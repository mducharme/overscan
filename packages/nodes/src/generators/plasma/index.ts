import { ASPECT_SCALE_GLSL } from '../../viewport-scale.js'
import {
  requireGlObject,
  resolveAnimatableFloat,
  type FrameBuffer,
  type Generator,
  type NodeContext,
  type Signal,
} from '@overscan/types'
import { PlasmaCPU } from './cpu.js'
import { defaultPalette, type PlasmaConfig } from './types.js'

export function PlasmaGenerator(config: Partial<PlasmaConfig> = {}): Generator {
  const cfg: PlasmaConfig = {
    speed:   config.speed   ?? 1,
    scale:   config.scale   ?? 1,
    palette: config.palette ?? defaultPalette,
    complexity: config.complexity ?? 4,
  }
  const cpu = new PlasmaCPU()
  let program: WebGLProgram | null = null
  let vao: WebGLVertexArrayObject | null = null
  let uTime: WebGLUniformLocation | null = null
  let uScale: WebGLUniformLocation | null = null
  let uResolution: WebGLUniformLocation | null = null
  let uComplexity: WebGLUniformLocation | null = null
  let uPaletteCount: WebGLUniformLocation | null = null
  let uPalette: WebGLUniformLocation | null = null

  function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type)
    if (!shader) throw new Error('PlasmaGenerator: createShader failed')
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? 'compile failed'
      gl.deleteShader(shader)
      throw new Error(`PlasmaGenerator: ${log}`)
    }
    return shader
  }

  function ensureGpu(ctx: NodeContext): void {
    const gl = ctx.gl
    if (!gl || program) return
    const vert = `#version 300 es
in vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`
    const frag = `#version 300 es
precision mediump float;
uniform float u_time;
uniform float u_scale;
uniform vec2 u_resolution;
uniform float u_complexity;
uniform float u_paletteCount;
uniform vec3 u_palette[8];
out vec4 fragColor;
vec3 samplePalette(float t) {
  float count = max(2.0, u_paletteCount);
  float scaled = clamp(t, 0.0, 1.0) * (count - 1.0);
  float idx = floor(scaled);
  float nextIdx = min(count - 1.0, idx + 1.0);
  float frac = fract(scaled);
  return mix(u_palette[int(idx)], u_palette[int(nextIdx)], frac);
}
${ASPECT_SCALE_GLSL}
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 p = (uv - 0.5) * aspectScale(u_resolution) * (3.5 * max(u_scale, 0.001));
  float v = 0.0;
  float c = clamp(u_complexity, 2.0, 8.0);
  v += sin(p.x * 3.0 + u_time * 1.7);
  v += sin(p.y * 4.0 - u_time * 1.3);
  if (c >= 3.0) v += sin((p.x + p.y) * 4.0 + u_time * 1.1);
  if (c >= 4.0) v += sin(length(p) * 6.0 - u_time * 1.9);
  if (c >= 5.0) v += sin((p.x * 1.7 - p.y * 0.8) * 3.0 + u_time * 0.9);
  if (c >= 6.0) v += sin((p.x * 0.5 + p.y * 2.2) * 2.7 - u_time * 1.5);
  if (c >= 7.0) v += sin(length(p + vec2(sin(u_time), cos(u_time)) * 0.3) * 8.0);
  if (c >= 8.0) v += sin((p.x * p.x + p.y * p.y) * 12.0 - u_time * 0.7);
  float n = 0.5 + 0.5 * sin((v / c) * 1.2 + u_time * 0.2);
  vec3 col = samplePalette(n);
  fragColor = vec4(col, 1.0);
}`
    const vs = compile(gl, gl.VERTEX_SHADER, vert)
    const fs = compile(gl, gl.FRAGMENT_SHADER, frag)
    const prog = requireGlObject(gl.createProgram(), 'PlasmaGenerator: createProgram failed')
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog) ?? 'link failed'
      gl.deleteProgram(prog)
      throw new Error(`PlasmaGenerator: ${log}`)
    }
    const quad = requireGlObject(gl.createBuffer(), 'PlasmaGenerator: quad init failed')
    const vaoObj = requireGlObject(gl.createVertexArray(), 'PlasmaGenerator: quad init failed')
    gl.bindVertexArray(vaoObj)
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(prog, 'a_pos')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
    program = prog
    vao = vaoObj
    uTime = gl.getUniformLocation(prog, 'u_time')
    uScale = gl.getUniformLocation(prog, 'u_scale')
    uResolution = gl.getUniformLocation(prog, 'u_resolution')
    uComplexity = gl.getUniformLocation(prog, 'u_complexity')
    uPaletteCount = gl.getUniformLocation(prog, 'u_paletteCount')
    uPalette = gl.getUniformLocation(prog, 'u_palette[0]')
  }

  return {
    type: 'generator',
    id:   'plasma',
    renderers: ['gpu', 'cpu'],
    config: cfg as unknown as Generator['config'],

    init(ctx: NodeContext) {
      cpu.init(ctx, cfg)
      ensureGpu(ctx)
    },

    render(ctx: NodeContext, out: FrameBuffer, signal: Signal) {
      const speed = resolveAnimatableFloat(cfg.speed, signal)
      const scale = resolveAnimatableFloat(cfg.scale, signal)
      const complexity = Math.max(2, Math.min(8, Math.round(cfg.complexity ?? 4)))
      if (ctx.gl && out.fbo && program && vao) {
        const gl = ctx.gl
        gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo)
        gl.viewport(0, 0, out.width, out.height)
        gl.useProgram(program)
        gl.bindVertexArray(vao)
        gl.uniform1f(uTime, signal.t * speed)
        gl.uniform1f(uScale, Math.max(scale, 0.01))
        gl.uniform2f(uResolution, out.width, out.height)
        gl.uniform1f(uComplexity, complexity)
        gl.uniform1f(uPaletteCount, Math.min(cfg.palette.length, 8))
        const flat = new Float32Array(8 * 3)
        for (let i = 0; i < 8; i++) {
          const c = cfg.palette[i] ?? cfg.palette[cfg.palette.length - 1] ?? defaultPalette[defaultPalette.length - 1]!
          flat[i * 3 + 0] = (c[0] ?? 0) / 255
          flat[i * 3 + 1] = (c[1] ?? 0) / 255
          flat[i * 3 + 2] = (c[2] ?? 0) / 255
        }
        if (uPalette) gl.uniform3fv(uPalette, flat)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        return
      }
      cpu.render(ctx, out, signal, cfg, speed, scale)
    },

    destroy() {
      program = null
      vao = null
      uTime = null
      uScale = null
      uResolution = null
      uComplexity = null
      uPaletteCount = null
      uPalette = null
    },
  }
}
