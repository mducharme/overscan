import {
  requireGlObject,
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Generator,
  type NodeContext,
  type Signal,
} from '@overscan/types'

type AnimVec3 = [AnimatableFloat, AnimatableFloat, AnimatableFloat]

export interface RaymarcherConfig {
  scene?: string
  scenePath?: string
  maxSteps?: number
  maxDist?: number
  epsilon?: number
  camera?: { pos?: [number, number, number]; target?: [number, number, number] }
  cameraPos?: AnimVec3
  lightDir?: [number, number, number]
  fogColor?: string
  chunkyScale?: number
  disableGpu?: boolean
}

export function RaymarcherGenerator(config: Partial<RaymarcherConfig> = {}): Generator {
  const inlineSceneCode = config.scene ?? 'return sdSphere(p, 0.85);'
  const scenePath = typeof config.scenePath === 'string' && config.scenePath.trim() !== ''
    ? config.scenePath
    : undefined
  const maxSteps = Math.max(8, Math.min(128, Math.round(config.maxSteps ?? 64)))
  const maxDist = Math.max(4, config.maxDist ?? 100)
  const epsilon = Math.max(0.0001, config.epsilon ?? 0.001)
  const cameraPosRef = config.cameraPos ?? [
    config.camera?.pos?.[0] ?? 0,
    config.camera?.pos?.[1] ?? 0,
    config.camera?.pos?.[2] ?? 3,
  ]
  const target = config.camera?.target ?? [0, 0, 0]
  const lightDir = normalize3(config.lightDir ?? [1, 1, -1])
  const fogColor = hexToRgb(config.fogColor ?? '#000000')
  const chunkyScale = Math.max(1, Math.min(8, Math.round(config.chunkyScale ?? 4)))
  const disableGpu = config.disableGpu ?? false
  let sceneCode = inlineSceneCode
  let sceneMap = buildSceneMap(sceneCode)
  let gpuReady = false
  let program: WebGLProgram | null = null
  let vao: WebGLVertexArrayObject | null = null
  let uResolution: WebGLUniformLocation | null = null
  let uTime: WebGLUniformLocation | null = null
  let uCameraPos: WebGLUniformLocation | null = null
  let uTarget: WebGLUniformLocation | null = null
  let uLightDir: WebGLUniformLocation | null = null
  let uFogColor: WebGLUniformLocation | null = null

  function resolveSceneCode(ctx?: NodeContext): string {
    const externalScene = scenePath ? ctx?.assets?.getText(scenePath)?.trim() : ''
    return externalScene && externalScene.length > 0 ? externalScene : inlineSceneCode
  }

  function syncSceneCode(ctx?: NodeContext): void {
    const nextSceneCode = resolveSceneCode(ctx)
    if (nextSceneCode === sceneCode) return
    sceneCode = nextSceneCode
    sceneMap = buildSceneMap(sceneCode)
    gpuReady = false
    program = null
    vao = null
    uResolution = null
    uTime = null
    uCameraPos = null
    uTarget = null
    uLightDir = null
    uFogColor = null
  }

  function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type)
    if (!shader) throw new Error('RaymarcherGenerator: createShader failed')
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? 'compile failed'
      gl.deleteShader(shader)
      throw new Error(`RaymarcherGenerator: ${log}`)
    }
    return shader
  }

  function ensureGpu(ctx: NodeContext): void {
    const gl = ctx.gl
    if (!gl || disableGpu || program || gpuReady) return
    const vert = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`
    const frag = `#version 300 es
precision mediump float;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_cameraPos;
uniform vec3 u_target;
uniform vec3 u_lightDir;
uniform vec3 u_fogColor;
out vec4 fragColor;
float sdSphere(vec3 p, float r) { return length(p) - r; }
float sdBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}
float sdTorus(vec3 p, vec2 t) {
  vec2 q = vec2(length(p.xz) - t.x, p.y);
  return length(q) - t.y;
}
mat2 rot(float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c);
}
float map(vec3 p) {
  ${sceneCode}
}
vec3 calcNormal(vec3 p) {
  vec2 e = vec2(${epsilon}, 0.0);
  return normalize(vec3(
    map(p + e.xyy) - map(p - e.xyy),
    map(p + e.yxy) - map(p - e.yxy),
    map(p + e.yyx) - map(p - e.yyx)
  ));
}
void main() {
  vec2 uv = (gl_FragCoord.xy / u_resolution - 0.5) * 2.0;
  uv.x *= u_resolution.x / max(u_resolution.y, 1.0);
  vec3 forward = normalize(u_target - u_cameraPos);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), forward));
  vec3 up = cross(forward, right);
  vec3 rd = normalize(forward + uv.x * right + uv.y * up);
  vec3 ro = u_cameraPos;
  float t = 0.0;
  bool hit = false;
  for (int i = 0; i < ${maxSteps}; i++) {
    vec3 p = ro + rd * t;
    float d = map(p);
    if (d < ${epsilon}) { hit = true; break; }
    t += d;
    if (t > ${maxDist}.0) break;
  }
  vec3 col = u_fogColor;
  if (hit) {
    vec3 p = ro + rd * t;
    vec3 n = calcNormal(p);
    float diff = max(dot(n, normalize(u_lightDir)), 0.0);
    float rim = pow(1.0 - max(dot(n, -rd), 0.0), 2.0);
    col = vec3(0.12, 0.95, 0.85) * diff + vec3(0.9, 0.2, 0.7) * rim + vec3(0.05);
    float fog = clamp(1.0 - t / ${maxDist}.0, 0.0, 1.0);
    col = mix(u_fogColor, col, fog);
  }
  fragColor = vec4(col, 1.0);
}`
    const vs = compile(gl, gl.VERTEX_SHADER, vert)
    const fs = compile(gl, gl.FRAGMENT_SHADER, frag)
    const prog = requireGlObject(gl.createProgram(), 'RaymarcherGenerator: createProgram failed')
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog) ?? 'link failed'
      gl.deleteProgram(prog)
      throw new Error(`RaymarcherGenerator: ${log}`)
    }
    const quad = requireGlObject(gl.createBuffer(), 'RaymarcherGenerator: quad init failed')
    const vaoObj = requireGlObject(gl.createVertexArray(), 'RaymarcherGenerator: quad init failed')
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
    uCameraPos = gl.getUniformLocation(prog, 'u_cameraPos')
    uTarget = gl.getUniformLocation(prog, 'u_target')
    uLightDir = gl.getUniformLocation(prog, 'u_lightDir')
    uFogColor = gl.getUniformLocation(prog, 'u_fogColor')
    gpuReady = true
  }

  return {
    type: 'generator',
    id: 'raymarcher',
    renderers: ['gpu', 'cpu'],
    config: config,
    init(ctx) {
      try {
        syncSceneCode(ctx)
        ensureGpu(ctx)
      } catch (error) {
        gpuReady = false
        program = null
        vao = null
        console.warn(error)
      }
    },
    render(ctx: NodeContext, out: FrameBuffer, signal: Signal): void {
      syncSceneCode(ctx)
      const cameraPos = [
        resolveAnimatableFloat(cameraPosRef[0], signal),
        resolveAnimatableFloat(cameraPosRef[1], signal),
        resolveAnimatableFloat(cameraPosRef[2], signal),
      ] as [number, number, number]
      if (!disableGpu && ctx.gl && out.fbo && program && vao && gpuReady) {
        try {
          const gl = ctx.gl
          gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo)
          gl.viewport(0, 0, out.width, out.height)
          gl.useProgram(program)
          gl.bindVertexArray(vao)
          gl.uniform2f(uResolution, out.width, out.height)
          gl.uniform1f(uTime, signal.t)
          gl.uniform3f(uCameraPos, cameraPos[0], cameraPos[1], cameraPos[2])
          gl.uniform3f(uTarget, target[0], target[1], target[2])
          gl.uniform3f(uLightDir, lightDir[0], lightDir[1], lightDir[2])
          gl.uniform3f(uFogColor, fogColor[0] / 255, fogColor[1] / 255, fogColor[2] / 255)
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
          return
        } catch (error) {
          gpuReady = false
          console.warn(error)
        }
      }
      renderCpu(out, signal.t, cameraPos, target, lightDir, fogColor, chunkyScale, sceneMap)
      if (ctx.gl && out.texture) {
        const gl = ctx.gl
        gl.bindTexture(gl.TEXTURE_2D, out.texture)
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          out.width,
          out.height,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          out.data,
        )
      }
    },
    destroy() {
      gpuReady = false
      program = null
      vao = null
      uResolution = null
      uTime = null
      uCameraPos = null
      uTarget = null
      uLightDir = null
      uFogColor = null
    },
  }
}

function renderCpu(
  out: FrameBuffer,
  time: number,
  cameraPos: [number, number, number],
  target: [number, number, number],
  lightDir: [number, number, number],
  fogColor: [number, number, number],
  chunkyScale: number,
  sceneMap: (p: [number, number, number], time: number) => number,
): void {
  const { width: w, height: h, data } = out
  const sw = Math.max(1, Math.floor(w / chunkyScale))
  const sh = Math.max(1, Math.floor(h / chunkyScale))
  const forward = normalize3(sub3(target, cameraPos))
  const right = normalize3(cross3([0, 1, 0], forward))
  const up = cross3(forward, right)
  for (let sy = 0; sy < sh; sy++) {
    for (let sx = 0; sx < sw; sx++) {
      const uvx = ((sx + 0.5) / sw - 0.5) * 2 * (sw / Math.max(1, sh))
      // Screen rows run top to bottom, so flip to make +uvy point along the camera's up (as gl_FragCoord does).
      const uvy = (0.5 - (sy + 0.5) / sh) * 2
      const rd = normalize3(add3(forward, add3(scale3(right, uvx), scale3(up, uvy))))
      const col = traceScene(cameraPos, rd, time, lightDir, fogColor, sceneMap)
      for (let yy = 0; yy < chunkyScale; yy++) {
        for (let xx = 0; xx < chunkyScale; xx++) {
          const x = sx * chunkyScale + xx
          const y = sy * chunkyScale + yy
          if (x >= w || y >= h) continue
          const o = (y * w + x) * 4
          data[o] = col[0]
          data[o + 1] = col[1]
          data[o + 2] = col[2]
          data[o + 3] = 255
        }
      }
    }
  }
}

function traceScene(
  ro: [number, number, number],
  rd: [number, number, number],
  time: number,
  lightDir: [number, number, number],
  fogColor: [number, number, number],
  sceneMap: (p: [number, number, number], time: number) => number,
): [number, number, number] {
  let t = 0
  const maxDist = 100
  const eps = 0.001
  for (let i = 0; i < 64; i++) {
    const p = add3(ro, scale3(rd, t))
    const d = sceneMap(p, time)
    if (d < eps) {
      const n = calcNormal(p, time, sceneMap)
      const diff = Math.max(0, dot3(n, lightDir))
      const rim = Math.pow(1 - Math.max(0, dot3(n, scale3(rd, -1))), 2)
      const base: [number, number, number] = [
        Math.round(31 * diff + 230 * rim + 13),
        Math.round(242 * diff + 51 * rim + 13),
        Math.round(217 * diff + 179 * rim + 13),
      ]
      const fog = Math.max(0, Math.min(1, 1 - t / maxDist))
      return mixRgb(fogColor, base, fog)
    }
    t += d
    if (t > maxDist) break
  }
  return fogColor
}

function defaultSceneMap(p: [number, number, number], time: number): number {
  const q: [number, number, number] = [p[0], p[1], p[2]]
  const c = Math.cos(time * 0.7)
  const s = Math.sin(time * 0.7)
  const x = q[0] * c - q[2] * s
  const z = q[0] * s + q[2] * c
  q[0] = x
  q[2] = z
  const sphere = length3(q) - 0.85
  const torus = sdTorus([q[0], q[1] * 0.75, q[2]], [1.15, 0.22])
  return Math.min(sphere, torus)
}

function calcNormal(
  p: [number, number, number],
  time: number,
  sceneMap: (p: [number, number, number], time: number) => number,
): [number, number, number] {
  const e = 0.001
  return normalize3([
    sceneMap([p[0] + e, p[1], p[2]], time) - sceneMap([p[0] - e, p[1], p[2]], time),
    sceneMap([p[0], p[1] + e, p[2]], time) - sceneMap([p[0], p[1] - e, p[2]], time),
    sceneMap([p[0], p[1], p[2] + e], time) - sceneMap([p[0], p[1], p[2] - e], time),
  ])
}

function buildSceneMap(source: string): (p: [number, number, number], time: number) => number {
  const normalized = source
    .replace(/\r/g, '')
    .replace(/^\s*float\s+/gm, 'let ')
    .replace(/^\s*vec2\s+/gm, 'let ')
    .replace(/^\s*vec3\s+/gm, 'let ')
    .replace(/([A-Za-z_][A-Za-z0-9_]*)\.xz\s*\*=\s*rot\(([^)]+)\);/g, '$1 = rotateXZ($1, $2);')
    // `vec3(...)` may contain one level of nested calls, e.g. vec3(0.0, 1.0 + sin(u_time), 0.0).
    .replace(/sd(Box|Sphere|Torus)\(\s*([A-Za-z_][A-Za-z0-9_.]*)\s*-\s*(vec3\((?:[^()]|\([^()]*\))*\))\s*,/g, 'sd$1(sub3($2, $3),')

  try {
    // Scene code is translated from the scene's own GLSL subset and evaluated as JS on purpose.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const evaluator = new Function(
      'p',
      'time',
      'api',
      `"use strict";
const { vec2, vec3, sdSphere, sdBox, sdTorus, rotateXZ, sub3, min } = api;
const { sin, cos, abs, max, sqrt, pow, floor } = Math;
const u_time = time;
${normalized}`,
    ) as (p: Vec3, time: number, api: SceneEvalApi) => number

    return (p, time) => {
      const result = evaluator(SCENE_EVAL_API.vec3(p[0], p[1], p[2]), time, SCENE_EVAL_API)
      return Number.isFinite(result) ? result : defaultSceneMap(p, time)
    }
  } catch {
    return defaultSceneMap
  }
}

type Vec2 = [number, number]
interface Vec3 { x: number; y: number; z: number }

interface SceneEvalApi {
  vec2(x: number, y: number): Vec2
  vec3(x: number | Vec3, y?: number, z?: number): Vec3
  sdSphere(p: Vec3, r: number): number
  sdBox(p: Vec3, b: Vec3): number
  sdTorus(p: Vec3, t: Vec2): number
  rotateXZ(p: Vec3, angle: number): Vec3
  sub3(a: Vec3, b: Vec3): Vec3
  min(...values: number[]): number
}

const SCENE_EVAL_API: SceneEvalApi = {
  vec2(x, y) {
    return [x, y]
  },
  vec3(x, y, z) {
    if (typeof x === 'object') return { x: x.x, y: x.y, z: x.z }
    return { x, y: y ?? 0, z: z ?? 0 }
  },
  sdSphere(p, r) {
    return Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z) - r
  },
  sdBox(p, b) {
    const qx = Math.abs(p.x) - b.x
    const qy = Math.abs(p.y) - b.y
    const qz = Math.abs(p.z) - b.z
    const ax = Math.max(qx, 0)
    const ay = Math.max(qy, 0)
    const az = Math.max(qz, 0)
    return Math.sqrt(ax * ax + ay * ay + az * az) + Math.min(Math.max(qx, Math.max(qy, qz)), 0)
  },
  sdTorus(p, t) {
    const qx = Math.sqrt(p.x * p.x + p.z * p.z) - t[0]
    return Math.sqrt(qx * qx + p.y * p.y) - t[1]
  },
  rotateXZ(p, angle) {
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    return {
      x: p.x * c - p.z * s,
      y: p.y,
      z: p.x * s + p.z * c,
    }
  },
  sub3(a, b) {
    return {
      x: a.x - b.x,
      y: a.y - b.y,
      z: a.z - b.z,
    }
  },
  min(...values) {
    return Math.min(...values)
  },
}

function sdTorus(p: [number, number, number], t: [number, number]): number {
  const qx = Math.sqrt(p[0] * p[0] + p[2] * p[2]) - t[0]
  const qy = p[1]
  return Math.sqrt(qx * qx + qy * qy) - t[1]
}

function hexToRgb(hex: string): [number, number, number] {
  const s = hex.replace('#', '')
  const n = parseInt(s.length === 3 ? s.split('').map(c => c + c).join('') : s, 16)
  return [
    Number.isFinite(n) ? (n >> 16) & 0xff : 0,
    Number.isFinite(n) ? (n >> 8) & 0xff : 0,
    Number.isFinite(n) ? n & 0xff : 0,
  ]
}

function dot3(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function length3(v: [number, number, number]): number {
  return Math.sqrt(dot3(v, v))
}

function normalize3(v: [number, number, number]): [number, number, number] {
  const l = Math.max(1e-6, length3(v))
  return [v[0] / l, v[1] / l, v[2] / l]
}

function add3(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function sub3(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function scale3(v: [number, number, number], s: number): [number, number, number] {
  return [v[0] * s, v[1] * s, v[2] * s]
}

function cross3(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

function mixRgb(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  return [
    Math.round(a[0] + (b[0] - a[0]) * x),
    Math.round(a[1] + (b[1] - a[1]) * x),
    Math.round(a[2] + (b[2] - a[2]) * x),
  ]
}
