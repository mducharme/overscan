import {
  requireGlObject,
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Generator,
  type NodeContext,
  type Signal,
} from '@overscan/types'

export interface FractalZoomConfig {
  type?: 'mandelbrot' | 'julia'
  juliaC?: [number, number]
  centerX?: AnimatableFloat
  centerY?: AnimatableFloat
  zoom?: AnimatableFloat
  zoomSpeed?: AnimatableFloat
  maxIter?: number
  palette?: number[][]
  paletteSpeed?: AnimatableFloat
  smooth?: boolean
}

const DEFAULT_PALETTE = [
  [8, 6, 24],
  [44, 24, 96],
  [110, 62, 170],
  [255, 128, 64],
  [255, 245, 180],
]

export function FractalZoomGenerator(config: Partial<FractalZoomConfig> = {}): Generator {
  const fractalType = config.type ?? 'mandelbrot'
  const juliaC = config.juliaC ?? [-0.7, 0.27]
  const centerXRef = config.centerX ?? -0.5
  const centerYRef = config.centerY ?? 0
  const zoomRef = config.zoom ?? 1
  const zoomSpeedRef = config.zoomSpeed ?? 0
  const maxIter = Math.max(8, Math.min(256, Math.round(config.maxIter ?? 64)))
  const palette = config.palette ?? DEFAULT_PALETTE
  const paletteSpeedRef = config.paletteSpeed ?? 0
  const smooth = config.smooth ?? true
  let program: WebGLProgram | null = null
  let vao: WebGLVertexArrayObject | null = null
  let uResolution: WebGLUniformLocation | null = null
  let uCenter: WebGLUniformLocation | null = null
  let uZoom: WebGLUniformLocation | null = null
  let uType: WebGLUniformLocation | null = null
  let uJulia: WebGLUniformLocation | null = null
  let uPaletteShift: WebGLUniformLocation | null = null
  let uPaletteCount: WebGLUniformLocation | null = null
  let uPalette0: WebGLUniformLocation | null = null

  function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type)
    if (!shader) throw new Error('FractalZoomGenerator: createShader failed')
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? 'compile failed'
      gl.deleteShader(shader)
      throw new Error(`FractalZoomGenerator: ${log}`)
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
uniform vec2 u_resolution;
uniform vec2 u_center;
uniform float u_zoom;
uniform float u_type;
uniform vec2 u_julia;
uniform float u_paletteShift;
uniform float u_paletteCount;
uniform vec3 u_palette[8];
out vec4 fragColor;
vec3 paletteSample(float t) {
  float count = max(2.0, u_paletteCount);
  float scaled = fract(t + u_paletteShift) * (count - 1.0);
  float idx = floor(scaled);
  float nextIdx = min(count - 1.0, idx + 1.0);
  return mix(u_palette[int(idx)], u_palette[int(nextIdx)], fract(scaled));
}
void main() {
  vec2 uv = (gl_FragCoord.xy / u_resolution - 0.5) * vec2(u_resolution.x / max(u_resolution.y,1.0), 1.0);
  vec2 c = u_type < 0.5 ? u_center + uv / max(u_zoom, 0.0001) : u_julia;
  vec2 z = u_type < 0.5 ? vec2(0.0) : u_center + uv / max(u_zoom, 0.0001);
  float iter = 0.0;
  for (int i = 0; i < ${maxIter}; i++) {
    float x = z.x * z.x - z.y * z.y + c.x;
    float y = 2.0 * z.x * z.y + c.y;
    z = vec2(x, y);
    if (dot(z, z) > 4.0) {
      iter = float(i);
      break;
    }
    iter = float(i);
  }
  float t = iter / ${maxIter}.0;
  fragColor = vec4(iter >= ${maxIter - 1}.0 ? vec3(0.0) : paletteSample(t), 1.0);
}`
    const vs = compile(gl, gl.VERTEX_SHADER, vert)
    const fs = compile(gl, gl.FRAGMENT_SHADER, frag)
    const prog = requireGlObject(gl.createProgram(), 'FractalZoomGenerator: createProgram failed')
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog) ?? 'link failed'
      gl.deleteProgram(prog)
      throw new Error(`FractalZoomGenerator: ${log}`)
    }
    const quad = requireGlObject(gl.createBuffer(), 'FractalZoomGenerator: quad init failed')
    const vaoObj = requireGlObject(gl.createVertexArray(), 'FractalZoomGenerator: quad init failed')
    gl.bindVertexArray(vaoObj)
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(prog, 'a_pos')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
    program = prog
    vao = vaoObj
    uResolution = gl.getUniformLocation(prog, 'u_resolution')
    uCenter = gl.getUniformLocation(prog, 'u_center')
    uZoom = gl.getUniformLocation(prog, 'u_zoom')
    uType = gl.getUniformLocation(prog, 'u_type')
    uJulia = gl.getUniformLocation(prog, 'u_julia')
    uPaletteShift = gl.getUniformLocation(prog, 'u_paletteShift')
    uPaletteCount = gl.getUniformLocation(prog, 'u_paletteCount')
    uPalette0 = gl.getUniformLocation(prog, 'u_palette[0]')
  }

  return {
    type: 'generator',
    id: 'fractal-zoom',
    renderers: ['gpu', 'cpu'],
    config: config,
    init(ctx) { ensureGpu(ctx) },
    render(ctx: NodeContext, out: FrameBuffer, signal: Signal): void {
      const centerX = resolveAnimatableFloat(centerXRef, signal)
      const centerY = resolveAnimatableFloat(centerYRef, signal)
      const baseZoom = Math.max(0.0001, resolveAnimatableFloat(zoomRef, signal))
      const zoomSpeed = resolveAnimatableFloat(zoomSpeedRef, signal)
      const zoom = baseZoom * Math.exp(signal.t * zoomSpeed * 0.15)
      const paletteShift = resolveAnimatableFloat(paletteSpeedRef, signal) * signal.t * 0.1
      if (ctx.gl && out.fbo && program && vao) {
        const gl = ctx.gl
        gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo)
        gl.viewport(0, 0, out.width, out.height)
        gl.useProgram(program)
        gl.bindVertexArray(vao)
        gl.uniform2f(uResolution, out.width, out.height)
        gl.uniform2f(uCenter, centerX, centerY)
        gl.uniform1f(uZoom, zoom)
        gl.uniform1f(uType, fractalType === 'julia' ? 1 : 0)
        gl.uniform2f(uJulia, juliaC[0], juliaC[1])
        gl.uniform1f(uPaletteShift, paletteShift)
        gl.uniform1f(uPaletteCount, Math.min(palette.length, 8))
        const flat = new Float32Array(8 * 3)
        for (let i = 0; i < 8; i++) {
          const c = palette[i % palette.length] ?? DEFAULT_PALETTE[i % DEFAULT_PALETTE.length]!
          flat[i * 3] = (c[0] ?? 0) / 255
          flat[i * 3 + 1] = (c[1] ?? 0) / 255
          flat[i * 3 + 2] = (c[2] ?? 0) / 255
        }
        if (uPalette0) gl.uniform3fv(uPalette0, flat)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        return
      }
      renderCpu(out, fractalType, juliaC, centerX, centerY, zoom, maxIter, palette, paletteShift, smooth)
    },
    destroy() {
      program = null
      vao = null
      uResolution = null
      uCenter = null
      uZoom = null
      uType = null
      uJulia = null
      uPaletteShift = null
      uPaletteCount = null
      uPalette0 = null
    },
  }
}

function renderCpu(
  out: FrameBuffer,
  fractalType: 'mandelbrot' | 'julia',
  juliaC: [number, number],
  centerX: number,
  centerY: number,
  zoom: number,
  maxIter: number,
  palette: number[][],
  paletteShift: number,
  smooth: boolean,
): void {
  const { width: w, height: h, data } = out
  const aspect = w / Math.max(1, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = ((x / Math.max(1, w - 1)) - 0.5) * 2 * aspect
      const py = ((y / Math.max(1, h - 1)) - 0.5) * 2
      let zx = fractalType === 'mandelbrot' ? 0 : centerX + px / zoom
      let zy = fractalType === 'mandelbrot' ? 0 : centerY + py / zoom
      const cx = fractalType === 'mandelbrot' ? centerX + px / zoom : juliaC[0]
      const cy = fractalType === 'mandelbrot' ? centerY + py / zoom : juliaC[1]
      let i = 0
      if (fractalType === 'mandelbrot' && inMainCardioidOrBulb(cx, cy)) i = maxIter
      for (; i < maxIter; i++) {
        const xx = zx * zx - zy * zy + cx
        const yy = 2 * zx * zy + cy
        zx = xx
        zy = yy
        if (zx * zx + zy * zy > 4) break
      }
      const o = (y * w + x) * 4
      if (i >= maxIter) {
        data[o] = 0; data[o + 1] = 0; data[o + 2] = 0; data[o + 3] = 255
      } else {
        const mu = smooth ? i + 1 - Math.log(Math.log(Math.sqrt(zx * zx + zy * zy))) / Math.log(2) : i
        const c = samplePalette(palette, mu / maxIter + paletteShift)
        data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255
      }
    }
  }
}

/** Interior of the main cardioid or period-2 bulb: these points never escape. */
function inMainCardioidOrBulb(cx: number, cy: number): boolean {
  const qx = cx - 0.25
  const q = qx * qx + cy * cy
  if (q * (q + qx) <= 0.25 * cy * cy) return true
  const bx = cx + 1
  return bx * bx + cy * cy <= 0.0625
}

function samplePalette(palette: number[][], t: number): [number, number, number] {
  const colors = palette.length > 1 ? palette : DEFAULT_PALETTE
  const x = ((t % 1) + 1) % 1
  const scaled = x * (colors.length - 1)
  const idx = Math.min(colors.length - 2, Math.floor(scaled))
  const frac = scaled - idx
  const a = colors[idx] ?? colors[0] ?? DEFAULT_PALETTE[0]!
  const b = colors[idx + 1] ?? a
  return [
    Math.round((a[0] ?? 0) + ((b[0] ?? 0) - (a[0] ?? 0)) * frac),
    Math.round((a[1] ?? 0) + ((b[1] ?? 0) - (a[1] ?? 0)) * frac),
    Math.round((a[2] ?? 0) + ((b[2] ?? 0) - (a[2] ?? 0)) * frac),
  ]
}
