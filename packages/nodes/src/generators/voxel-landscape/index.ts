import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Generator,
  type LoadedImageAsset,
  type NodeContext,
  type Signal,
} from '@overscan/types'

export interface VoxelLandscapeConfig {
  heightmap?: string | 'noise'
  colormap?: string | 'auto'
  horizon?: AnimatableFloat
  scale?: AnimatableFloat
  speed?: AnimatableFloat
  cameraHeight?: AnimatableFloat
  cameraAngle?: AnimatableFloat
  drawDistance?: number
  fogColor?: string
}

export function VoxelLandscapeGenerator(config: Partial<VoxelLandscapeConfig> = {}): Generator {
  const heightmapUrl = config.heightmap && config.heightmap !== 'noise' ? config.heightmap : undefined
  const colormapUrl = config.colormap && config.colormap !== 'auto' ? config.colormap : undefined
  const horizonRef = config.horizon ?? 0.5
  const scaleRef = config.scale ?? 1
  const speedRef = config.speed ?? 1
  const cameraHeightRef = config.cameraHeight ?? 150
  const cameraAngleRef = config.cameraAngle ?? 0
  const drawDistance = Math.max(40, Math.min(600, Math.round(config.drawDistance ?? 300)))
  const fogColor = hexToRgb(config.fogColor ?? '#87ceeb')
  let program: WebGLProgram | null = null
  let vao: WebGLVertexArrayObject | null = null
  let uResolution: WebGLUniformLocation | null = null
  let uTime: WebGLUniformLocation | null = null
  let uHorizon: WebGLUniformLocation | null = null
  let uScale: WebGLUniformLocation | null = null
  let uCameraHeight: WebGLUniformLocation | null = null
  let uCameraAngle: WebGLUniformLocation | null = null
  let uFog: WebGLUniformLocation | null = null

  function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type)
    if (!shader) throw new Error('VoxelLandscapeGenerator: createShader failed')
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? 'compile failed'
      gl.deleteShader(shader)
      throw new Error(`VoxelLandscapeGenerator: ${log}`)
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
uniform float u_horizon;
uniform float u_scale;
uniform float u_cameraHeight;
uniform float u_cameraAngle;
uniform vec3 u_fog;
out vec4 fragColor;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float terrain(vec2 p) {
  float h = noise(p * 0.045) * 0.65 + noise(p * 0.11) * 0.25 + noise(p * 0.23) * 0.10;
  return h;
}
vec3 terrainColor(float h) {
  vec3 low = vec3(0.07, 0.14, 0.24);
  vec3 mid = vec3(0.18, 0.45, 0.22);
  vec3 high = vec3(0.72, 0.68, 0.45);
  return h < 0.45 ? mix(low, mid, h / 0.45) : mix(mid, high, (h - 0.45) / 0.55);
}
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float sky = smoothstep(0.0, 1.0, uv.y / max(u_horizon, 0.001));
  vec3 col = mix(u_fog * 0.45, u_fog, sky);
  float xNorm = (uv.x - 0.5) * 1.4;
  float angle = u_cameraAngle + xNorm * 0.8;
  float maxY = u_resolution.y;
  for (float d = 1.0; d <= 320.0; d += 1.0) {
    if (d > ${drawDistance}.0) break;
    vec2 pos = vec2(cos(angle), sin(angle)) * (d + u_time * 22.0);
    float h = terrain(pos) * 180.0 * u_scale;
    float proj = u_horizon * u_resolution.y - ((h - u_cameraHeight) / d) * 55.0;
    if (proj < maxY) {
      float fog = clamp(1.0 - d / ${drawDistance}.0, 0.0, 1.0);
      vec3 terr = mix(u_fog, terrainColor(h / max(1.0, 180.0 * u_scale)), fog);
      if (gl_FragCoord.y >= proj && gl_FragCoord.y <= maxY) {
        col = terr;
        maxY = proj;
      }
    }
  }
  fragColor = vec4(col, 1.0);
}`
    const vs = compile(gl, gl.VERTEX_SHADER, vert)
    const fs = compile(gl, gl.FRAGMENT_SHADER, frag)
    const prog = gl.createProgram()
    if (!prog) throw new Error('VoxelLandscapeGenerator: createProgram failed')
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog) ?? 'link failed'
      gl.deleteProgram(prog)
      throw new Error(`VoxelLandscapeGenerator: ${log}`)
    }
    const quad = gl.createBuffer()
    const vaoObj = gl.createVertexArray()
    if (!quad || !vaoObj) throw new Error('VoxelLandscapeGenerator: quad init failed')
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
    uHorizon = gl.getUniformLocation(prog, 'u_horizon')
    uScale = gl.getUniformLocation(prog, 'u_scale')
    uCameraHeight = gl.getUniformLocation(prog, 'u_cameraHeight')
    uCameraAngle = gl.getUniformLocation(prog, 'u_cameraAngle')
    uFog = gl.getUniformLocation(prog, 'u_fog')
  }

  return {
    type: 'generator',
    id: 'voxel-landscape',
    renderers: ['cpu'],
    config: config as Generator['config'],
    init() {},
    render(ctx: NodeContext, out: FrameBuffer, signal: Signal): void {
      const horizon = resolveAnimatableFloat(horizonRef, signal)
      const scale = resolveAnimatableFloat(scaleRef, signal)
      const speed = resolveAnimatableFloat(speedRef, signal)
      const cameraHeight = resolveAnimatableFloat(cameraHeightRef, signal)
      const cameraAngle = resolveAnimatableFloat(cameraAngleRef, signal)
      const time = signal.t * speed
      const heightmap = heightmapUrl ? ctx.assets?.getImage(heightmapUrl) : undefined
      const colormap = colormapUrl ? ctx.assets?.getImage(colormapUrl) : undefined
      if (ctx.gl && out.fbo && program && vao) {
        const gl = ctx.gl
        gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo)
        gl.viewport(0, 0, out.width, out.height)
        gl.useProgram(program)
        gl.bindVertexArray(vao)
        gl.uniform2f(uResolution, out.width, out.height)
        gl.uniform1f(uTime, time)
        gl.uniform1f(uHorizon, horizon)
        gl.uniform1f(uScale, scale)
        gl.uniform1f(uCameraHeight, cameraHeight)
        gl.uniform1f(uCameraAngle, cameraAngle)
        gl.uniform3f(uFog, fogColor[0] / 255, fogColor[1] / 255, fogColor[2] / 255)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        return
      }

      const { width: w, height: h, data } = out
      const horizonY = Math.round(h * horizon)
      for (let y = 0; y < h; y++) {
        const skyT = y / Math.max(1, horizonY)
        const sky = y <= horizonY ? blend(mul(fogColor, 0.45), fogColor, skyT) : fogColor
        for (let x = 0; x < w; x++) {
          const o = (y * w + x) * 4
          data[o] = sky[0]
          data[o + 1] = sky[1]
          data[o + 2] = sky[2]
          data[o + 3] = 255
        }
      }
      for (let x = 0; x < w; x++) {
        let maxY = h
        const xNorm = (x / Math.max(1, w - 1) - 0.5) * 1.4
        const angle = cameraAngle + xNorm * 0.8
        const rayX = Math.cos(angle)
        const rayY = Math.sin(angle)
        const travel = time * 22
        for (let d = 1; d <= drawDistance; d++) {
          const px = rayX * (d + travel)
          const py = rayY * (d + travel)
          const terr = sampleTerrain(heightmap, px, py) * 180 * scale
          const proj = horizonY - ((terr - cameraHeight) / d) * 55
          if (proj < maxY) {
            const fog = Math.max(0, Math.min(1, 1 - d / drawDistance))
            const terrCol = blend(
              fogColor,
              sampleTerrainColor(colormap, terr / Math.max(1, 180 * scale)),
              fog,
            )
            const yStart = Math.max(0, Math.floor(proj))
            const yEnd = Math.min(h - 1, Math.floor(maxY))
            for (let y = yStart; y <= yEnd; y++) {
              const o = (y * w + x) * 4
              data[o] = terrCol[0]
              data[o + 1] = terrCol[1]
              data[o + 2] = terrCol[2]
              data[o + 3] = 255
            }
            maxY = proj
            if (maxY <= 0) break
          }
        }
      }
    },
    destroy() {
      program = null
      vao = null
      uResolution = null
      uTime = null
      uHorizon = null
      uScale = null
      uCameraHeight = null
      uCameraAngle = null
      uFog = null
    },
  }
}

function hashNoise(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123
  return n - Math.floor(n)
}

/** Last lattice cell's corner hashes; consecutive ray samples mostly stay in the same cell. */
interface NoiseCell {
  ix: number
  iy: number
  a: number
  b: number
  c: number
  d: number
}

const terrainCells: NoiseCell[] = [0, 1, 2].map(() => ({ ix: NaN, iy: NaN, a: 0, b: 0, c: 0, d: 0 }))

function noise(x: number, y: number, cell: NoiseCell): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  if (cell.ix !== ix || cell.iy !== iy) {
    cell.ix = ix
    cell.iy = iy
    cell.a = hashNoise(ix, iy)
    cell.b = hashNoise(ix + 1, iy)
    cell.c = hashNoise(ix, iy + 1)
    cell.d = hashNoise(ix + 1, iy + 1)
  }
  return lerp(lerp(cell.a, cell.b, ux), lerp(cell.c, cell.d, ux), uy)
}

function terrain(x: number, y: number): number {
  return noise(x * 0.045, y * 0.045, terrainCells[0]!) * 0.65
    + noise(x * 0.11, y * 0.11, terrainCells[1]!) * 0.25
    + noise(x * 0.23, y * 0.23, terrainCells[2]!) * 0.1
}

function sampleTerrain(image: LoadedImageAsset | undefined, x: number, y: number): number {
  if (!image) return terrain(x, y)
  const u = x * 0.01 - Math.floor(x * 0.01)
  const v = y * 0.01 - Math.floor(y * 0.01)
  const sx = Math.max(0, Math.min(image.width - 1, Math.round(u * (image.width - 1))))
  const sy = Math.max(0, Math.min(image.height - 1, Math.round(v * (image.height - 1))))
  const i = (sy * image.width + sx) * 4
  return ((image.data[i] ?? 0) + (image.data[i + 1] ?? 0) + (image.data[i + 2] ?? 0)) / (255 * 3)
}

function terrainColor(t: number): [number, number, number] {
  const low: [number, number, number] = [18, 36, 61]
  const mid: [number, number, number] = [46, 115, 56]
  const high: [number, number, number] = [184, 173, 115]
  return t < 0.45 ? blend(low, mid, t / 0.45) : blend(mid, high, (t - 0.45) / 0.55)
}

function sampleTerrainColor(
  image: LoadedImageAsset | undefined,
  t: number,
): [number, number, number] {
  if (!image) return terrainColor(t)
  const x = Math.max(0, Math.min(image.width - 1, Math.round(Math.max(0, Math.min(1, t)) * (image.width - 1))))
  const i = x * 4
  return [image.data[i] ?? 0, image.data[i + 1] ?? 0, image.data[i + 2] ?? 0]
}

function blend(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  return [
    Math.round(lerp(a[0], b[0], x)),
    Math.round(lerp(a[1], b[1], x)),
    Math.round(lerp(a[2], b[2], x)),
  ]
}

function mul(a: [number, number, number], v: number): [number, number, number] {
  return [Math.round(a[0] * v), Math.round(a[1] * v), Math.round(a[2] * v)]
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function hexToRgb(hex: string): [number, number, number] {
  const s = hex.replace('#', '')
  const n = parseInt(s.length === 3 ? s.split('').map(c => c + c).join('') : s, 16)
  return [
    Number.isFinite(n) ? (n >> 16) & 0xff : 135,
    Number.isFinite(n) ? (n >> 8) & 0xff : 206,
    Number.isFinite(n) ? n & 0xff : 235,
  ]
}
