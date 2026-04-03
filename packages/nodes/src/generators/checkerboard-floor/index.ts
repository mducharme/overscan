import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Generator,
  type NodeContext,
  type Signal,
} from '@overscan/types'

export interface CheckerboardFloorConfig {
  color1?: string
  color2?: string
  horizon?: AnimatableFloat
  cameraHeight?: AnimatableFloat
  tileSize?: AnimatableFloat
  scrollSpeed?: AnimatableFloat
  rotationSpeed?: AnimatableFloat
  fogDistance?: AnimatableFloat
  fogColor?: string
  skyColor?: string
}

export function CheckerboardFloorGenerator(config: Partial<CheckerboardFloorConfig> = {}): Generator {
  const color1 = hexToRgb(config.color1 ?? '#ffffff')
  const color2 = hexToRgb(config.color2 ?? '#000000')
  const horizonRef = config.horizon ?? 0.5
  const cameraHeightRef = config.cameraHeight ?? 1
  const tileSizeRef = config.tileSize ?? 1
  const scrollSpeedRef = config.scrollSpeed ?? 0
  const rotationSpeedRef = config.rotationSpeed ?? 0
  const fogDistanceRef = config.fogDistance ?? 0.6
  const fogColor = hexToRgb(config.fogColor ?? '#000000')
  const skyColor = hexToRgb(config.skyColor ?? '#000000')
  let program: WebGLProgram | null = null
  let vao: WebGLVertexArrayObject | null = null
  let uResolution: WebGLUniformLocation | null = null
  let uHorizon: WebGLUniformLocation | null = null
  let uCameraHeight: WebGLUniformLocation | null = null
  let uTileSize: WebGLUniformLocation | null = null
  let uScroll: WebGLUniformLocation | null = null
  let uRot: WebGLUniformLocation | null = null
  let uFogDistance: WebGLUniformLocation | null = null
  let uColor1: WebGLUniformLocation | null = null
  let uColor2: WebGLUniformLocation | null = null
  let uFogColor: WebGLUniformLocation | null = null
  let uSkyColor: WebGLUniformLocation | null = null

  function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type)
    if (!shader) throw new Error('CheckerboardFloorGenerator: createShader failed')
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? 'compile failed'
      gl.deleteShader(shader)
      throw new Error(`CheckerboardFloorGenerator: ${log}`)
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
uniform float u_horizon;
uniform float u_cameraHeight;
uniform float u_tileSize;
uniform float u_scroll;
uniform float u_rot;
uniform float u_fogDistance;
uniform vec3 u_color1;
uniform vec3 u_color2;
uniform vec3 u_fogColor;
uniform vec3 u_skyColor;
out vec4 fragColor;
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  if (uv.y <= u_horizon) {
    fragColor = vec4(u_skyColor, 1.0);
    return;
  }
  float p = (uv.y - u_horizon) / max(0.001, 1.0 - u_horizon);
  float depth = u_cameraHeight / max(0.02, p);
  float angle = (uv.x - 0.5) * 2.2 + u_rot;
  float wx = sin(angle) * depth / max(0.02, u_tileSize);
  float wz = cos(angle) * depth / max(0.02, u_tileSize) + u_scroll;
  float chk = mod(floor(wx) + floor(wz), 2.0);
  vec3 base = mix(u_color1, u_color2, chk);
  float fog = clamp(1.0 - depth / max(0.1, u_fogDistance * 24.0), 0.0, 1.0);
  fragColor = vec4(mix(u_fogColor, base, fog), 1.0);
}`
    const vs = compile(gl, gl.VERTEX_SHADER, vert)
    const fs = compile(gl, gl.FRAGMENT_SHADER, frag)
    const prog = gl.createProgram()
    if (!prog) throw new Error('CheckerboardFloorGenerator: createProgram failed')
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog)
    gl.deleteShader(vs); gl.deleteShader(fs)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog) ?? 'link failed'
      gl.deleteProgram(prog)
      throw new Error(`CheckerboardFloorGenerator: ${log}`)
    }
    const quad = gl.createBuffer()
    const vaoObj = gl.createVertexArray()
    if (!quad || !vaoObj) throw new Error('CheckerboardFloorGenerator: quad init failed')
    gl.bindVertexArray(vaoObj)
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(prog, 'a_pos')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
    program = prog
    vao = vaoObj
    uResolution = gl.getUniformLocation(prog, 'u_resolution')
    uHorizon = gl.getUniformLocation(prog, 'u_horizon')
    uCameraHeight = gl.getUniformLocation(prog, 'u_cameraHeight')
    uTileSize = gl.getUniformLocation(prog, 'u_tileSize')
    uScroll = gl.getUniformLocation(prog, 'u_scroll')
    uRot = gl.getUniformLocation(prog, 'u_rot')
    uFogDistance = gl.getUniformLocation(prog, 'u_fogDistance')
    uColor1 = gl.getUniformLocation(prog, 'u_color1')
    uColor2 = gl.getUniformLocation(prog, 'u_color2')
    uFogColor = gl.getUniformLocation(prog, 'u_fogColor')
    uSkyColor = gl.getUniformLocation(prog, 'u_skyColor')
  }

  return {
    type: 'generator',
    id: 'checkerboard-floor',
    renderers: ['gpu', 'cpu'],
    config: config as Generator['config'],
    init(ctx) { ensureGpu(ctx) },
    render(ctx: NodeContext, out: FrameBuffer, signal: Signal): void {
      const horizon = Math.max(0.05, Math.min(0.95, resolveAnimatableFloat(horizonRef, signal)))
      const cameraHeight = Math.max(0.05, resolveAnimatableFloat(cameraHeightRef, signal))
      const tileSize = Math.max(0.02, resolveAnimatableFloat(tileSizeRef, signal))
      const scroll = resolveAnimatableFloat(scrollSpeedRef, signal) * signal.t
      const rot = resolveAnimatableFloat(rotationSpeedRef, signal) * signal.t
      const fogDistance = Math.max(0.05, Math.min(1, resolveAnimatableFloat(fogDistanceRef, signal)))
      if (ctx.gl && out.fbo && program && vao) {
        const gl = ctx.gl
        gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo)
        gl.viewport(0,0,out.width,out.height)
        gl.useProgram(program); gl.bindVertexArray(vao)
        gl.uniform2f(uResolution, out.width, out.height)
        gl.uniform1f(uHorizon, horizon); gl.uniform1f(uCameraHeight, cameraHeight); gl.uniform1f(uTileSize, tileSize)
        gl.uniform1f(uScroll, scroll); gl.uniform1f(uRot, rot); gl.uniform1f(uFogDistance, fogDistance)
        gl.uniform3f(uColor1, color1[0]/255, color1[1]/255, color1[2]/255)
        gl.uniform3f(uColor2, color2[0]/255, color2[1]/255, color2[2]/255)
        gl.uniform3f(uFogColor, fogColor[0]/255, fogColor[1]/255, fogColor[2]/255)
        gl.uniform3f(uSkyColor, skyColor[0]/255, skyColor[1]/255, skyColor[2]/255)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        return
      }
      renderCpu(out, horizon, cameraHeight, tileSize, scroll, rot, fogDistance, color1, color2, fogColor, skyColor)
    },
    destroy() { program = null; vao = null },
  }
}

function renderCpu(
  out: FrameBuffer,
  horizon: number,
  cameraHeight: number,
  tileSize: number,
  scroll: number,
  rot: number,
  fogDistance: number,
  color1: [number, number, number],
  color2: [number, number, number],
  fogColor: [number, number, number],
  skyColor: [number, number, number],
): void {
  const { width: w, height: h, data } = out
  const horizonY = Math.floor(h * horizon)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      let c = skyColor
      if (y > horizonY) {
        const p = (y - horizonY) / Math.max(1, h - horizonY)
        const depth = cameraHeight / Math.max(0.02, p)
        const angle = ((x / Math.max(1, w - 1)) - 0.5) * 2.2 + rot
        const wx = Math.sin(angle) * depth / tileSize
        const wz = Math.cos(angle) * depth / tileSize + scroll
        const chk = ((Math.floor(wx) + Math.floor(wz)) & 1) === 0 ? color1 : color2
        const fog = Math.max(0, Math.min(1, 1 - depth / Math.max(0.1, fogDistance * 24)))
        c = mixRgb(fogColor, chk, fog)
      }
      data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255
    }
  }
}

function mixRgb(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [Math.round(a[0] + (b[0]-a[0])*t), Math.round(a[1] + (b[1]-a[1])*t), Math.round(a[2] + (b[2]-a[2])*t)]
}

function hexToRgb(hex: string): [number, number, number] {
  const s = hex.replace('#', '')
  const n = parseInt(s.length === 3 ? s.split('').map(c => c + c).join('') : s, 16)
  return [Number.isFinite(n) ? (n >> 16) & 0xff : 255, Number.isFinite(n) ? (n >> 8) & 0xff : 255, Number.isFinite(n) ? n & 0xff : 255]
}
