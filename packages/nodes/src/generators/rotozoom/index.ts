import { ASPECT_SCALE_GLSL, aspectScale } from '../../viewport-scale.js'
import {
  requireGlObject,
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Generator,
  type LoadedImageAsset,
  type NodeContext,
  type Signal,
} from '@overscan/types'

export interface RotozoomConfig {
  textureUrl?: string
  rotationSpeed?: AnimatableFloat
  zoomSpeed?: AnimatableFloat
  zoomRange?: [number, number]
  centerX?: AnimatableFloat
  centerY?: AnimatableFloat
  tileX?: number
  tileY?: number
}

export function RotozoomGenerator(config: Partial<RotozoomConfig> = {}): Generator {
  const textureUrl = config.textureUrl
  const rotationSpeedRef = config.rotationSpeed ?? 1
  const zoomSpeedRef = config.zoomSpeed ?? 0.5
  const zoomRange = config.zoomRange ?? [0.5, 2]
  const centerXRef = config.centerX ?? 0.5
  const centerYRef = config.centerY ?? 0.5
  const tileX = Math.max(1, Math.round(config.tileX ?? 2))
  const tileY = Math.max(1, Math.round(config.tileY ?? 2))
  let program: WebGLProgram | null = null
  let vao: WebGLVertexArrayObject | null = null
  let uResolution: WebGLUniformLocation | null = null
  let uAngle: WebGLUniformLocation | null = null
  let uZoom: WebGLUniformLocation | null = null
  let uCenter: WebGLUniformLocation | null = null
  let uTile: WebGLUniformLocation | null = null

  function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type)
    if (!shader) throw new Error('RotozoomGenerator: createShader failed')
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? 'compile failed'
      gl.deleteShader(shader)
      throw new Error(`RotozoomGenerator: ${log}`)
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
uniform float u_angle;
uniform float u_zoom;
uniform vec2 u_center;
uniform vec2 u_tile;
out vec4 fragColor;
vec3 pattern(vec2 uv) {
  vec2 p = fract(uv);
  float checker = step(0.5, fract(floor(uv.x) * 0.5 + floor(uv.y) * 0.5));
  vec3 a = vec3(0.04, 0.05, 0.15);
  vec3 b = vec3(0.95, 0.45, 0.05);
  vec3 c = mix(a, b, checker);
  float grid = smoothstep(0.05, 0.0, min(abs(p.x - 0.5), abs(p.y - 0.5)));
  return c + grid * vec3(0.3, 0.55, 0.8);
}
${ASPECT_SCALE_GLSL}
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 p = (uv - u_center) * aspectScale(u_resolution);
  float c = cos(u_angle);
  float s = sin(u_angle);
  vec2 rot = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  vec2 tex = rot / max(u_zoom, 0.001) + 0.5;
  tex *= u_tile;
  fragColor = vec4(pattern(tex), 1.0);
}`
    const vs = compile(gl, gl.VERTEX_SHADER, vert)
    const fs = compile(gl, gl.FRAGMENT_SHADER, frag)
    const prog = requireGlObject(gl.createProgram(), 'RotozoomGenerator: createProgram failed')
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog) ?? 'link failed'
      gl.deleteProgram(prog)
      throw new Error(`RotozoomGenerator: ${log}`)
    }
    const quad = requireGlObject(gl.createBuffer(), 'RotozoomGenerator: quad init failed')
    const vaoObj = requireGlObject(gl.createVertexArray(), 'RotozoomGenerator: quad init failed')
    gl.bindVertexArray(vaoObj)
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(prog, 'a_pos')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
    program = prog
    vao = vaoObj
    uResolution = gl.getUniformLocation(prog, 'u_resolution')
    uAngle = gl.getUniformLocation(prog, 'u_angle')
    uZoom = gl.getUniformLocation(prog, 'u_zoom')
    uCenter = gl.getUniformLocation(prog, 'u_center')
    uTile = gl.getUniformLocation(prog, 'u_tile')
  }

  return {
    type: 'generator',
    id: 'rotozoom',
    renderers: ['gpu', 'cpu'],
    config: config,
    init(ctx) {
      ensureGpu(ctx)
    },
    render(ctx: NodeContext, out: FrameBuffer, signal: Signal): void {
      const rotationSpeed = resolveAnimatableFloat(rotationSpeedRef, signal)
      const zoomSpeed = resolveAnimatableFloat(zoomSpeedRef, signal)
      const centerX = resolveAnimatableFloat(centerXRef, signal)
      const centerY = resolveAnimatableFloat(centerYRef, signal)
      const angle = signal.t * rotationSpeed
      const zoomOsc = Math.sin(signal.t * zoomSpeed) * 0.5 + 0.5
      const zoom = zoomRange[0] + (zoomRange[1] - zoomRange[0]) * zoomOsc
      const texture = textureUrl ? ctx.assets?.getImage(textureUrl) : undefined
      if (ctx.gl && out.fbo && program && vao) {
        const gl = ctx.gl
        gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo)
        gl.viewport(0, 0, out.width, out.height)
        gl.useProgram(program)
        gl.bindVertexArray(vao)
        gl.uniform2f(uResolution, out.width, out.height)
        gl.uniform1f(uAngle, angle)
        gl.uniform1f(uZoom, zoom)
        gl.uniform2f(uCenter, centerX, centerY)
        gl.uniform2f(uTile, tileX, tileY)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        return
      }

      const { width: w, height: h, data } = out
      const c = Math.cos(angle)
      const s = Math.sin(angle)
      const aspect = aspectScale(w, h)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const uvx = x / Math.max(1, w - 1)
          const uvy = y / Math.max(1, h - 1)
          const px = (uvx - centerX) * aspect.x
          const py = (uvy - centerY) * aspect.y
          const rx = px * c - py * s
          const ry = px * s + py * c
          const tu = (rx / Math.max(zoom, 0.001) + 0.5) * tileX
          const tv = (ry / Math.max(zoom, 0.001) + 0.5) * tileY
          const col = texture ? sampleImage(texture, tu, tv) : samplePattern(tu, tv)
          const o = (y * w + x) * 4
          data[o] = col[0]
          data[o + 1] = col[1]
          data[o + 2] = col[2]
          data[o + 3] = 255
        }
      }
    },
    destroy() {
      program = null
      vao = null
      uResolution = null
      uAngle = null
      uZoom = null
      uCenter = null
      uTile = null
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

function samplePattern(u: number, v: number): [number, number, number] {
  const fu = u - Math.floor(u)
  const fv = v - Math.floor(v)
  const checker = ((Math.floor(u) + Math.floor(v)) & 1) === 0 ? 0 : 1
  const base = checker === 0 ? [12, 14, 38] : [245, 116, 16]
  const grid = Math.max(0, 1 - Math.min(Math.abs(fu - 0.5), Math.abs(fv - 0.5)) / 0.05)
  return [
    Math.min(255, (base[0] ?? 0) + grid * 80),
    Math.min(255, (base[1] ?? 0) + grid * 120),
    Math.min(255, (base[2] ?? 0) + grid * 180),
  ]
}
