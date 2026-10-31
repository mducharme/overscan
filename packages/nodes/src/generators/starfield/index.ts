import { frameSteps } from '../../frame-time.js'
import { createRng, DEFAULT_RANDOM_SEED } from '../../random.js'
import {
  requireGlObject,
  resolveAnimatableFloat,
  type AnimatableFloat,
  type Generator,
  type NodeContext,
  type FrameBuffer,
  type Signal,
} from '@overscan/types'
import { VIEWPORT_REF_MIN } from '../../viewport-scale.js'

export interface StarfieldConfig {
  /** Seed for this node's randomness (default 1); vary it to decorrelate identical nodes. */
  randomSeed?: number
  count?: number
  warpSpeed?: AnimatableFloat
  starColor?: [number, number, number]
  spread?: number
  sizeRange?: [number, number]
  centerX?: AnimatableFloat
  centerY?: AnimatableFloat
}

interface Star {
  x: number
  y: number
  z: number
}

export function StarfieldGenerator(config: Partial<StarfieldConfig> = {}): Generator {
  const count = Math.max(1, Math.min(2000, config.count ?? 120))
  const randomSeed = config.randomSeed ?? DEFAULT_RANDOM_SEED
  let rng = createRng(randomSeed)
  const speedRef = config.warpSpeed ?? 1
  const col = config.starColor ?? [255, 255, 255]
  const spread = Math.max(0.1, config.spread ?? 1)
  const sizeRange = config.sizeRange ?? [1, 3]
  const centerXRef = config.centerX ?? 0.5
  const centerYRef = config.centerY ?? 0.5
  const stars: Star[] = []
  let program: WebGLProgram | null = null
  let vao: WebGLVertexArrayObject | null = null
  let uTime: WebGLUniformLocation | null = null
  let uCount: WebGLUniformLocation | null = null
  let uColor: WebGLUniformLocation | null = null
  let uResolution: WebGLUniformLocation | null = null
  let uSpeed: WebGLUniformLocation | null = null
  let uCenter: WebGLUniformLocation | null = null
  let uSpread: WebGLUniformLocation | null = null
  let uSizeRange: WebGLUniformLocation | null = null

  function initStars(): void {
    rng = createRng(randomSeed)
    stars.length = 0
    for (let i = 0; i < count; i++) {
      stars.push({
        x: (rng() * 2 - 1) * spread,
        y: (rng() * 2 - 1) * spread,
        z: rng() * 0.9 + 0.1,
      })
    }
  }

  function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type)
    if (!shader) throw new Error('StarfieldGenerator: createShader failed')
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? 'compile failed'
      gl.deleteShader(shader)
      throw new Error(`StarfieldGenerator: ${log}`)
    }
    return shader
  }

  function ensureGpu(ctx: NodeContext): void {
    const gl = ctx.gl
    if (!gl || program) return
    const vert = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`
    const frag = `#version 300 es
precision highp float;
uniform float u_time;
uniform float u_count;
uniform float u_speed;
uniform vec3 u_color;
uniform vec2 u_resolution;
uniform vec2 u_center;
uniform float u_spread;
uniform vec2 u_sizeRange;
out vec4 fragColor;
float hash(float n) { return fract(sin(n) * 43758.5453123); }
vec2 starPos(float i) {
  return (vec2(hash(i * 13.1), hash(i * 29.7)) - 0.5) * 2.0 * u_spread;
}
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec3 colOut = vec3(0.0);
  float count = max(8.0, u_count);
  for (float i = 0.0; i < 256.0; i += 1.0) {
    if (i >= count) break;
    vec2 p = starPos(i);
    float z = fract(hash(i * 7.3) - u_time * 0.04 * max(u_speed, 0.05));
    z = max(z, 0.04);
    vec2 pos = p / z + u_center;
    float d = length(uv - pos);
    float pointSize = mix(u_sizeRange.x, u_sizeRange.y, 1.0 - z) / min(u_resolution.x, u_resolution.y);
    float s = smoothstep(pointSize / max(z, 0.1), 0.0, d);
    colOut += u_color * s * (1.1 - z);
  }
  fragColor = vec4(min(colOut, vec3(1.0)), 1.0);
}`
    const vs = compile(gl, gl.VERTEX_SHADER, vert)
    const fs = compile(gl, gl.FRAGMENT_SHADER, frag)
    const prog = requireGlObject(gl.createProgram(), 'StarfieldGenerator: createProgram failed')
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog) ?? 'link failed'
      gl.deleteProgram(prog)
      throw new Error(`StarfieldGenerator: ${log}`)
    }
    const quad = requireGlObject(gl.createBuffer(), 'StarfieldGenerator: quad init failed')
    const vaoObj = requireGlObject(gl.createVertexArray(), 'StarfieldGenerator: quad init failed')
    gl.bindVertexArray(vaoObj)
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(prog, 'a_pos')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
    program = prog
    vao = vaoObj
    uTime = gl.getUniformLocation(prog, 'u_time')
    uCount = gl.getUniformLocation(prog, 'u_count')
    uColor = gl.getUniformLocation(prog, 'u_color')
    uResolution = gl.getUniformLocation(prog, 'u_resolution')
    uSpeed = gl.getUniformLocation(prog, 'u_speed')
    uCenter = gl.getUniformLocation(prog, 'u_center')
    uSpread = gl.getUniformLocation(prog, 'u_spread')
    uSizeRange = gl.getUniformLocation(prog, 'u_sizeRange')
  }

  return {
    type:       'generator',
    id:         'starfield',
    renderers:  ['gpu', 'cpu'],
    config:     config,
    init:       (ctx: NodeContext) => {
      initStars()
      ensureGpu(ctx)
    },
    render(_ctx: NodeContext, out: FrameBuffer, signal: Signal) {
      const warp = Math.max(0.05, resolveAnimatableFloat(speedRef, signal))
      const centerX = resolveAnimatableFloat(centerXRef, signal)
      const centerY = resolveAnimatableFloat(centerYRef, signal)
      if (_ctx.gl && out.fbo && program && vao) {
        const gl = _ctx.gl
        gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo)
        gl.viewport(0, 0, out.width, out.height)
        gl.useProgram(program)
        gl.bindVertexArray(vao)
        gl.uniform1f(uTime, signal.t)
        gl.uniform1f(uCount, Math.min(count, 256))
        gl.uniform1f(uSpeed, Math.max(warp * 7, 0.1))
        gl.uniform3f(uColor, col[0] / 255, col[1] / 255, col[2] / 255)
        gl.uniform2f(uResolution, out.width, out.height)
        gl.uniform2f(uCenter, centerX, centerY)
        gl.uniform1f(uSpread, spread)
        gl.uniform2f(uSizeRange, sizeRange[0], sizeRange[1])
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        return
      }
      const { width: w, height: h, data } = out
      data.fill(0)
      const cx = w * centerX
      const cy = h * centerY
      const scale = Math.min(w, h) * 0.34
      const steps = frameSteps(signal)

      for (const s of stars) {
        s.z -= warp * 0.035 * steps
        if (s.z <= 0.02) {
          s.x = (rng() * 2 - 1) * spread
          s.y = (rng() * 2 - 1) * spread
          s.z = 1
        }
        const px = (s.x / s.z) * scale + cx
        const py = (s.y / s.z) * scale + cy
        if (px < -4 || px >= w + 4 || py < -4 || py >= h + 4) continue
        const depth = Math.max(0, Math.min(1, 1 - s.z))
        const bri = 0.35 + depth * 1.35
        const size = Math.max(sizeRange[0], Math.min(sizeRange[1] + 1, sizeRange[0] + depth * ((sizeRange[1] + 1) - sizeRange[0])))
        const minD = Math.min(w, h)
        const rad = Math.max(1, Math.round((size * minD) / VIEWPORT_REF_MIN))
        const trailX = s.x / Math.max(s.z + warp * 0.07, 0.04) * scale + cx
        const trailY = s.y / Math.max(s.z + warp * 0.07, 0.04) * scale + cy

        drawTrail(data, w, h, trailX, trailY, px, py, col, depth, warp)
        for (let yy = -rad + 1; yy < rad; yy++) {
          for (let xx = -rad + 1; xx < rad; xx++) {
            const xi = Math.floor(px + xx)
            const yi = Math.floor(py + yy)
            if (xi < 0 || yi < 0 || xi >= w || yi >= h) continue
            const d = Math.sqrt(xx * xx + yy * yy)
            if (d > rad) continue
            const falloff = 1 - d / Math.max(rad, 1)
            const o = (yi * w + xi) * 4
            data[o + 0] = Math.min(255, Math.round((data[o + 0] ?? 0) + col[0] * bri * falloff))
            data[o + 1] = Math.min(255, Math.round((data[o + 1] ?? 0) + col[1] * bri * falloff))
            data[o + 2] = Math.min(255, Math.round((data[o + 2] ?? 0) + col[2] * bri * falloff))
            data[o + 3] = 255
          }
        }
      }
    },
    destroy: () => {
      program = null
      vao = null
      uTime = null
      uCount = null
      uColor = null
      uResolution = null
      uSpeed = null
      uCenter = null
      uSpread = null
      uSizeRange = null
    },
  }
}

function drawTrail(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  col: [number, number, number],
  depth: number,
  warp: number,
): void {
  const dx = x1 - x0
  const dy = y1 - y0
  const length = Math.sqrt(dx * dx + dy * dy)
  const samples = Math.max(1, Math.min(12, Math.round(length / 2)))
  const strength = Math.max(0, Math.min(1, depth * Math.min(1, warp / 4)))
  if (strength <= 0.08) return
  for (let i = 0; i <= samples; i++) {
    const t = i / Math.max(1, samples)
    const xi = Math.round(x0 + dx * t)
    const yi = Math.round(y0 + dy * t)
    if (xi < 0 || yi < 0 || xi >= w || yi >= h) continue
    const o = (yi * w + xi) * 4
    const fade = (1 - t) * strength * 0.45
    data[o + 0] = Math.min(255, Math.round((data[o + 0] ?? 0) + col[0] * fade))
    data[o + 1] = Math.min(255, Math.round((data[o + 1] ?? 0) + col[1] * fade))
    data[o + 2] = Math.min(255, Math.round((data[o + 2] ?? 0) + col[2] * fade))
    data[o + 3] = 255
  }
}
