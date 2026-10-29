import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Generator,
  type LoadedImageAsset,
  type NodeContext,
  type Signal,
} from '@overscan/types'

export interface TunnelConfig {
  textureUrl?: string
  speed?: AnimatableFloat
  twist?: AnimatableFloat
  fog?: AnimatableFloat
  zoom?: AnimatableFloat
  offsetX?: AnimatableFloat
  offsetY?: AnimatableFloat
}

export function TunnelGenerator(config: Partial<TunnelConfig> = {}): Generator {
  const textureUrl = config.textureUrl
  const speedRef = config.speed ?? 1
  const twistRef = config.twist ?? 0
  const fogRef = config.fog ?? 0.4
  const zoomRef = config.zoom ?? 1
  const offsetXRef = config.offsetX ?? 0
  const offsetYRef = config.offsetY ?? 0

  let program: WebGLProgram | null = null
  let vao: WebGLVertexArrayObject | null = null
  let uResolution: WebGLUniformLocation | null = null
  let uTime: WebGLUniformLocation | null = null
  let uTwist: WebGLUniformLocation | null = null
  let uFog: WebGLUniformLocation | null = null
  let uZoom: WebGLUniformLocation | null = null
  let uOffset: WebGLUniformLocation | null = null

  function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type)
    if (!shader) throw new Error('TunnelGenerator: createShader failed')
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? 'compile failed'
      gl.deleteShader(shader)
      throw new Error(`TunnelGenerator: ${log}`)
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
precision mediump float;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_twist;
uniform float u_fog;
uniform float u_zoom;
uniform vec2 u_offset;
out vec4 fragColor;
vec3 pattern(vec2 uv) {
  vec2 p = fract(uv);
  float check = step(0.5, fract(floor(uv.x) * 0.5 + floor(uv.y) * 0.5));
  vec3 a = vec3(0.02, 0.65, 0.95);
  vec3 b = vec3(1.0, 0.15, 0.75);
  vec3 c = mix(a, b, check);
  float line = smoothstep(0.08, 0.0, min(abs(p.x - 0.5), abs(p.y - 0.5)));
  return c + line * 0.35;
}
void main() {
  vec2 uv = (gl_FragCoord.xy / u_resolution - 0.5) * 2.0;
  uv += u_offset;
  float z = max(0.06, length(uv) / max(u_zoom, 0.05));
  float angle = atan(uv.y, uv.x) / 6.28318530718 + 0.5 + u_time * 0.02 + z * u_twist;
  float depth = 1.0 / z + u_time * max(0.05, u_time * 0.0 + 0.35);
  vec2 tex = vec2(angle * 12.0, depth * 3.0);
  vec3 col = pattern(tex);
  float fog = clamp(exp(-z * mix(0.6, 4.0, clamp(u_fog, 0.0, 1.0))), 0.0, 1.0);
  fragColor = vec4(col * fog, 1.0);
}`
    const vs = compile(gl, gl.VERTEX_SHADER, vert)
    const fs = compile(gl, gl.FRAGMENT_SHADER, frag)
    const prog = gl.createProgram()
    if (!prog) throw new Error('TunnelGenerator: createProgram failed')
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog) ?? 'link failed'
      gl.deleteProgram(prog)
      throw new Error(`TunnelGenerator: ${log}`)
    }
    const quad = gl.createBuffer()
    const vaoObj = gl.createVertexArray()
    if (!quad || !vaoObj) throw new Error('TunnelGenerator: quad init failed')
    gl.bindVertexArray(vaoObj)
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(prog, 'a_pos')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
    program = prog
    vao = vaoObj
    uResolution = gl.getUniformLocation(prog, 'u_resolution')
    uTime = gl.getUniformLocation(prog, 'u_time')
    uTwist = gl.getUniformLocation(prog, 'u_twist')
    uFog = gl.getUniformLocation(prog, 'u_fog')
    uZoom = gl.getUniformLocation(prog, 'u_zoom')
    uOffset = gl.getUniformLocation(prog, 'u_offset')
  }

  return {
    type: 'generator',
    id: 'tunnel',
    renderers: ['gpu', 'cpu'],
    config: config as Generator['config'],
    init(ctx) {
      ensureGpu(ctx)
    },
    render(ctx: NodeContext, out: FrameBuffer, signal: Signal): void {
      const speed = resolveAnimatableFloat(speedRef, signal)
      const twist = resolveAnimatableFloat(twistRef, signal)
      const fog = resolveAnimatableFloat(fogRef, signal)
      const zoom = Math.max(0.05, resolveAnimatableFloat(zoomRef, signal))
      const offsetX = resolveAnimatableFloat(offsetXRef, signal)
      const offsetY = resolveAnimatableFloat(offsetYRef, signal)
      const time = signal.t * speed
      const texture = textureUrl ? ctx.assets?.getImage(textureUrl) : undefined
      if (ctx.gl && out.fbo && program && vao) {
        const gl = ctx.gl
        gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo)
        gl.viewport(0, 0, out.width, out.height)
        gl.useProgram(program)
        gl.bindVertexArray(vao)
        gl.uniform2f(uResolution, out.width, out.height)
        gl.uniform1f(uTime, time)
        gl.uniform1f(uTwist, twist)
        gl.uniform1f(uFog, fog)
        gl.uniform1f(uZoom, zoom)
        gl.uniform2f(uOffset, offsetX, offsetY)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        return
      }

      const { width: w, height: h, data } = out
      const colNx = new Float64Array(w)
      for (let x = 0; x < w; x++) colNx[x] = ((x / Math.max(1, w - 1)) - 0.5) * 2 + offsetX
      for (let y = 0; y < h; y++) {
        const ny = ((y / Math.max(1, h - 1)) - 0.5) * 2 + offsetY
        for (let x = 0; x < w; x++) {
          const nx = colNx[x]!
          const z = Math.max(0.06, Math.sqrt(nx * nx + ny * ny) / zoom)
          const angle = Math.atan2(ny, nx) / (Math.PI * 2) + 0.5 + time * 0.35 + z * twist
          const depth = 1 / z + time * 1.2
          const c = texture
            ? sampleImage(texture, angle * 12, depth * 3)
            : sampleTunnelPattern(angle * 12, depth * 3, patternScratch)
          const fogAmt = Math.max(0, Math.min(1, Math.exp(-z * (0.6 + Math.max(0, fog) * 3.4))))
          const o = (y * w + x) * 4
          data[o] = Math.round(c[0] * fogAmt)
          data[o + 1] = Math.round(c[1] * fogAmt)
          data[o + 2] = Math.round(c[2] * fogAmt)
          data[o + 3] = 255
        }
      }
    },
    destroy() {
      program = null
      vao = null
      uResolution = null
      uTime = null
      uTwist = null
      uFog = null
      uZoom = null
      uOffset = null
    },
  }
}

function sampleImage(
  image: LoadedImageAsset,
  u: number,
  v: number,
): [number, number, number] {
  const fu = u - Math.floor(u)
  const fv = v - Math.floor(v)
  const x = Math.max(0, Math.min(image.width - 1, Math.round(fu * (image.width - 1))))
  const y = Math.max(0, Math.min(image.height - 1, Math.round(fv * (image.height - 1))))
  const i = (y * image.width + x) * 4
  return [image.data[i] ?? 0, image.data[i + 1] ?? 0, image.data[i + 2] ?? 0]
}

const TUNNEL_COLOR_A = [8, 166, 242] as const
const TUNNEL_COLOR_B = [255, 36, 170] as const
/** Reused by `sampleTunnelPattern`; read it before the next call. */
const patternScratch: [number, number, number] = [0, 0, 0]

function sampleTunnelPattern(u: number, v: number, out: [number, number, number]): [number, number, number] {
  const fu = u - Math.floor(u)
  const fv = v - Math.floor(v)
  const cell = ((Math.floor(u) + Math.floor(v)) & 1) === 0 ? 0 : 1
  const base = cell === 0 ? TUNNEL_COLOR_A : TUNNEL_COLOR_B
  const line = Math.max(0, 1 - Math.min(Math.abs(fu - 0.5), Math.abs(fv - 0.5)) / 0.08)
  out[0] = Math.min(255, base[0] + line * 90)
  out[1] = Math.min(255, base[1] + line * 90)
  out[2] = Math.min(255, base[2] + line * 90)
  return out
}
