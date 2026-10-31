import {
  requireGlObject,
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Generator,
  type NodeContext,
  type Signal,
} from '@overscan/types'
import { VIEWPORT_REF_MIN } from '../../viewport-scale.js'

export interface LasersConfig {
  beamCount?: number
  emitterCount?: number
  spread?: AnimatableFloat
  sweepSpeed?: AnimatableFloat
  rotationSpeed?: AnimatableFloat
  beamWidth?: AnimatableFloat
  glowWidth?: AnimatableFloat
  length?: AnimatableFloat
  intensity?: AnimatableFloat
  jitter?: AnimatableFloat
  drift?: AnimatableFloat
  audioReactive?: AnimatableFloat
  backgroundColor?: string
  palette?: string[]
}

const DEFAULT_PALETTE = ['#ff2bd6', '#45f4ff', '#7dff6b', '#ffd84d']
const MAX_GPU_EMITTERS = 6
const MAX_GPU_BEAMS = 32
/** Full-res CPU trace on small frames; 2× downsample only when plenty of pixels. */
function laserCpuChunky(w: number, h: number): number {
  return Math.min(w, h) <= 128 ? 1 : 2
}

export function LasersGenerator(config: Partial<LasersConfig> = {}): Generator {
  const beamCount = Math.max(1, Math.min(64, Math.round(config.beamCount ?? 18)))
  const emitterCount = Math.max(1, Math.min(6, Math.round(config.emitterCount ?? 3)))
  const spreadRef = config.spread ?? 1.6
  const sweepSpeedRef = config.sweepSpeed ?? 0.9
  const rotationSpeedRef = config.rotationSpeed ?? 0.45
  const beamWidthRef = config.beamWidth ?? 2.2
  const glowWidthRef = config.glowWidth ?? 18
  const lengthRef = config.length ?? 1.15
  const intensityRef = config.intensity ?? 1
  const jitterRef = config.jitter ?? 0.08
  const driftRef = config.drift ?? 0.2
  const audioReactiveRef = config.audioReactive ?? 0.4
  const background = hexToRgb(config.backgroundColor ?? '#020409')
  const palette = (config.palette?.length ? config.palette : DEFAULT_PALETTE).map(hexToRgb)
  let program: WebGLProgram | null = null
  let vao: WebGLVertexArrayObject | null = null
  let uResolution: WebGLUniformLocation | null = null
  let uTime: WebGLUniformLocation | null = null
  let uBeamCount: WebGLUniformLocation | null = null
  let uEmitterCount: WebGLUniformLocation | null = null
  let uSpread: WebGLUniformLocation | null = null
  let uSweepSpeed: WebGLUniformLocation | null = null
  let uRotationSpeed: WebGLUniformLocation | null = null
  let uBeamWidth: WebGLUniformLocation | null = null
  let uGlowWidth: WebGLUniformLocation | null = null
  let uLength: WebGLUniformLocation | null = null
  let uIntensity: WebGLUniformLocation | null = null
  let uJitter: WebGLUniformLocation | null = null
  let uDrift: WebGLUniformLocation | null = null
  let uBackground: WebGLUniformLocation | null = null
  let uPalette0: WebGLUniformLocation | null = null

  function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type)
    if (!shader) throw new Error('LasersGenerator: createShader failed')
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? 'compile failed'
      gl.deleteShader(shader)
      throw new Error(`LasersGenerator: ${log}`)
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
uniform float u_time;
uniform float u_beamCount;
uniform float u_emitterCount;
uniform float u_spread;
uniform float u_sweepSpeed;
uniform float u_rotationSpeed;
uniform float u_beamWidth;
uniform float u_glowWidth;
uniform float u_length;
uniform float u_intensity;
uniform float u_jitter;
uniform float u_drift;
uniform vec3 u_background;
uniform vec3 u_palette[4];
out vec4 fragColor;

float beamMask(vec2 p, vec2 a, vec2 dir, float len, float radius) {
  vec2 rel = p - a;
  float along = dot(rel, dir);
  if (along < 0.0 || along > len) return 0.0;
  float off = abs(rel.x * dir.y - rel.y * dir.x);
  return max(0.0, 1.0 - off / max(radius, 0.0001));
}

void main() {
  vec2 p = gl_FragCoord.xy;
  vec3 col = u_background;
  float minDim = min(u_resolution.x, u_resolution.y);
  float beamCount = max(1.0, min(u_beamCount, float(${MAX_GPU_BEAMS})));
  float emitterCount = max(1.0, min(u_emitterCount, float(${MAX_GPU_EMITTERS})));
  for (int ei = 0; ei < ${MAX_GPU_EMITTERS}; ei++) {
    if (float(ei) >= emitterCount) break;
    float emitterPhase = emitterCount <= 1.0 ? 0.5 : float(ei) / max(1.0, emitterCount - 1.0);
    vec2 origin = vec2(
      u_resolution.x * (0.15 + emitterPhase * 0.7 + sin(u_time * 0.43 + float(ei) * 1.7) * 0.04 * u_drift),
      u_resolution.y * (0.9 - cos(u_time * 0.31 + float(ei)) * 0.05 * u_drift)
    );
    float fanBase = -1.57079632679 + sin(u_time * u_rotationSpeed + float(ei) * 1.3) * 0.55;
    for (int bi = 0; bi < ${MAX_GPU_BEAMS}; bi++) {
      if (float(bi) >= beamCount) break;
      float beamPhase = beamCount <= 1.0 ? 0.5 : float(bi) / max(1.0, beamCount - 1.0);
      float sweep = (beamPhase - 0.5) * u_spread;
      float wave = sin(u_time * u_sweepSpeed * 2.4 + float(ei) * 0.9 + float(bi) * 0.37) * u_spread * 0.22;
      float shimmer = sin(u_time * 5.2 + float(bi) * 0.73 + float(ei) * 1.11) * u_jitter;
      float angle = fanBase + sweep + wave + shimmer;
      float pulse = 0.55 + 0.45 * sin(u_time * 3.6 + float(bi) * 0.42 + float(ei) * 0.8);
      float beamLen = minDim * u_length * (0.72 + pulse * 0.33);
      vec2 dir = vec2(cos(angle), sin(angle));
      float fade = pow(max(0.0, 1.0 - clamp(dot(p - origin, dir) / max(beamLen, 1.0), 0.0, 1.0)), 0.22);
      float glow = beamMask(p, origin, dir, beamLen, u_glowWidth) * fade * u_intensity * 0.08;
      float core = beamMask(p, origin, dir, beamLen, u_beamWidth) * fade * u_intensity * 0.42;
      vec3 beamColor = u_palette[(ei + bi) % 4] * min(1.6, 0.45 + pulse * 0.55);
      col += beamColor * (glow + core);
    }
    float emitterDist = length(p - origin);
    float emitterGlow = pow(max(0.0, 1.0 - emitterDist / max(u_glowWidth * 0.45, 1.0)), 2.0);
    col += u_palette[ei % 4] * emitterGlow * u_intensity * 0.18;
  }
  fragColor = vec4(min(col, vec3(1.0)), 1.0);
}`
    const vs = compile(gl, gl.VERTEX_SHADER, vert)
    const fs = compile(gl, gl.FRAGMENT_SHADER, frag)
    const prog = requireGlObject(gl.createProgram(), 'LasersGenerator: createProgram failed')
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog) ?? 'link failed'
      gl.deleteProgram(prog)
      throw new Error(`LasersGenerator: ${log}`)
    }
    const quad = requireGlObject(gl.createBuffer(), 'LasersGenerator: quad init failed')
    const vaoObj = requireGlObject(gl.createVertexArray(), 'LasersGenerator: quad init failed')
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
    uBeamCount = gl.getUniformLocation(prog, 'u_beamCount')
    uEmitterCount = gl.getUniformLocation(prog, 'u_emitterCount')
    uSpread = gl.getUniformLocation(prog, 'u_spread')
    uSweepSpeed = gl.getUniformLocation(prog, 'u_sweepSpeed')
    uRotationSpeed = gl.getUniformLocation(prog, 'u_rotationSpeed')
    uBeamWidth = gl.getUniformLocation(prog, 'u_beamWidth')
    uGlowWidth = gl.getUniformLocation(prog, 'u_glowWidth')
    uLength = gl.getUniformLocation(prog, 'u_length')
    uIntensity = gl.getUniformLocation(prog, 'u_intensity')
    uJitter = gl.getUniformLocation(prog, 'u_jitter')
    uDrift = gl.getUniformLocation(prog, 'u_drift')
    uBackground = gl.getUniformLocation(prog, 'u_background')
    uPalette0 = gl.getUniformLocation(prog, 'u_palette[0]')
  }

  return {
    type: 'generator',
    id: 'lasers',
    renderers: ['gpu', 'cpu'],
    config: config,
    init(ctx) { ensureGpu(ctx) },
    render(ctx: NodeContext, out: FrameBuffer, signal: Signal): void {
      const { width: w, height: h, data } = out
      const spread = Math.max(0.08, resolveAnimatableFloat(spreadRef, signal))
      const sweepSpeed = resolveAnimatableFloat(sweepSpeedRef, signal)
      const rotationSpeed = resolveAnimatableFloat(rotationSpeedRef, signal)
      const minD = Math.min(w, h)
      const cfgBeam = Math.max(0.5, resolveAnimatableFloat(beamWidthRef, signal))
      const cfgGlow = Math.max(cfgBeam, resolveAnimatableFloat(glowWidthRef, signal))
      const beamWidth = Math.max(1, (cfgBeam * minD) / VIEWPORT_REF_MIN)
      const glowWidth = Math.max(
        beamWidth * 1.75,
        (cfgGlow * minD) / VIEWPORT_REF_MIN,
      )
      const length = Math.max(0.1, resolveAnimatableFloat(lengthRef, signal))
      const jitter = Math.max(0, resolveAnimatableFloat(jitterRef, signal))
      const drift = resolveAnimatableFloat(driftRef, signal)
      const reactive = Math.max(0, resolveAnimatableFloat(audioReactiveRef, signal))
      const audioBoost = 1 + signal.rms * reactive * 1.6 + signal.spectral * reactive * 0.8
      const intensity = Math.max(0.1, resolveAnimatableFloat(intensityRef, signal)) * audioBoost

      if (ctx.gl && out.fbo && program && vao) {
        const gl = ctx.gl
        gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo)
        gl.viewport(0, 0, out.width, out.height)
        gl.useProgram(program)
        gl.bindVertexArray(vao)
        gl.uniform2f(uResolution, out.width, out.height)
        gl.uniform1f(uTime, signal.t)
        gl.uniform1f(uBeamCount, Math.min(beamCount, MAX_GPU_BEAMS))
        gl.uniform1f(uEmitterCount, Math.min(emitterCount, MAX_GPU_EMITTERS))
        gl.uniform1f(uSpread, spread)
        gl.uniform1f(uSweepSpeed, sweepSpeed)
        gl.uniform1f(uRotationSpeed, rotationSpeed)
        gl.uniform1f(uBeamWidth, beamWidth)
        gl.uniform1f(uGlowWidth, glowWidth)
        gl.uniform1f(uLength, length)
        gl.uniform1f(uIntensity, intensity)
        gl.uniform1f(uJitter, jitter)
        gl.uniform1f(uDrift, drift)
        gl.uniform3f(uBackground, background[0] / 255, background[1] / 255, background[2] / 255)
        const flatPalette = new Float32Array(12)
        for (let i = 0; i < 4; i++) {
          const color = palette[i % palette.length] ?? palette[0]!
          flatPalette[i * 3] = color[0] / 255
          flatPalette[i * 3 + 1] = color[1] / 255
          flatPalette[i * 3 + 2] = color[2] / 255
        }
        if (uPalette0) gl.uniform3fv(uPalette0, flatPalette)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        return
      }
      renderCpu(data, w, h, signal.t, {
        beamCount,
        emitterCount,
        spread,
        sweepSpeed,
        rotationSpeed,
        beamWidth,
        glowWidth,
        length,
        intensity,
        jitter,
        drift,
        background,
        palette,
      })
    },
    destroy() {
      program = null
      vao = null
      uResolution = null
      uTime = null
      uBeamCount = null
      uEmitterCount = null
      uSpread = null
      uSweepSpeed = null
      uRotationSpeed = null
      uBeamWidth = null
      uGlowWidth = null
      uLength = null
      uIntensity = null
      uJitter = null
      uDrift = null
      uBackground = null
      uPalette0 = null
    },
  }
}

interface ResolvedLasersConfig {
  beamCount: number
  emitterCount: number
  spread: number
  sweepSpeed: number
  rotationSpeed: number
  beamWidth: number
  glowWidth: number
  length: number
  intensity: number
  jitter: number
  drift: number
  background: [number, number, number]
  palette: [number, number, number][]
}

/** Per-frame beam geometry; identical math to the per-pixel version, hoisted out of the pixel loop. */
interface LaserBeam {
  originX: number
  originY: number
  dirX: number
  dirY: number
  beamLength: number
  fadeDenom: number
  colorScale: number
  color: [number, number, number]
}

interface LaserEmitter {
  originX: number
  originY: number
  color: [number, number, number]
  beams: LaserBeam[]
}

function buildLaserEmitters(w: number, h: number, minDim: number, time: number, cfg: ResolvedLasersConfig): LaserEmitter[] {
  const emitters: LaserEmitter[] = []
  for (let emitterIndex = 0; emitterIndex < cfg.emitterCount; emitterIndex++) {
    const emitterPhase = cfg.emitterCount === 1 ? 0.5 : emitterIndex / Math.max(1, cfg.emitterCount - 1)
    const originX = w * (0.15 + emitterPhase * 0.7 + Math.sin(time * 0.43 + emitterIndex * 1.7) * 0.04 * cfg.drift)
    const originY = h * (0.9 - Math.cos(time * 0.31 + emitterIndex) * 0.05 * cfg.drift)
    const fanBase = -Math.PI * 0.5 + Math.sin(time * cfg.rotationSpeed + emitterIndex * 1.3) * 0.55
    const beams: LaserBeam[] = []
    for (let beamIndex = 0; beamIndex < cfg.beamCount; beamIndex++) {
      const beamPhase = cfg.beamCount === 1 ? 0.5 : beamIndex / Math.max(1, cfg.beamCount - 1)
      const sweep = (beamPhase - 0.5) * cfg.spread
      const wave = Math.sin(time * cfg.sweepSpeed * 2.4 + emitterIndex * 0.9 + beamIndex * 0.37) * cfg.spread * 0.22
      const shimmer = Math.sin(time * 5.2 + beamIndex * 0.73 + emitterIndex * 1.11) * cfg.jitter
      const angle = fanBase + sweep + wave + shimmer
      const pulse = 0.55 + 0.45 * Math.sin(time * 3.6 + beamIndex * 0.42 + emitterIndex * 0.8)
      const beamLength = minDim * cfg.length * (0.72 + pulse * 0.33)
      beams.push({
        originX,
        originY,
        dirX: Math.cos(angle),
        dirY: Math.sin(angle),
        beamLength,
        fadeDenom: Math.max(beamLength, 1),
        colorScale: Math.min(1.6, 0.45 + pulse * 0.55),
        color: cfg.palette[(beamIndex + emitterIndex) % cfg.palette.length] ?? cfg.palette[0]!,
      })
    }
    emitters.push({
      originX,
      originY,
      color: cfg.palette[emitterIndex % cfg.palette.length] ?? cfg.palette[0]!,
      beams,
    })
  }
  return emitters
}

function renderCpu(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  time: number,
  cfg: ResolvedLasersConfig,
): void {
  fillBackground(data, cfg.background)
  const chunky = laserCpuChunky(w, h)
  const sw = Math.max(1, Math.floor(w / chunky))
  const sh = Math.max(1, Math.floor(h / chunky))
  const minDim = Math.min(w, h)
  const emitters = buildLaserEmitters(w, h, minDim, time, cfg)
  const color: [number, number, number] = [0, 0, 0]
  for (let sy = 0; sy < sh; sy++) {
    for (let sx = 0; sx < sw; sx++) {
      const px = (sx + 0.5) * chunky
      const py = (sy + 0.5) * chunky
      sampleLaserPoint(px, py, emitters, cfg, color)
      for (let yy = 0; yy < chunky; yy++) {
        for (let xx = 0; xx < chunky; xx++) {
          const x = sx * chunky + xx
          const y = sy * chunky + yy
          if (x >= w || y >= h) continue
          const idx = (y * w + x) * 4
          data[idx] = color[0]
          data[idx + 1] = color[1]
          data[idx + 2] = color[2]
          data[idx + 3] = 255
        }
      }
    }
  }
}

function sampleLaserPoint(
  px: number,
  py: number,
  emitters: LaserEmitter[],
  cfg: ResolvedLasersConfig,
  out: [number, number, number],
): void {
  let r = cfg.background[0]
  let g = cfg.background[1]
  let b = cfg.background[2]
  const glowDenom = Math.max(cfg.glowWidth, 0.001)
  const beamDenom = Math.max(cfg.beamWidth, 0.001)
  const emitterGlowDenom = Math.max(cfg.glowWidth * 0.45, 1)
  for (const emitter of emitters) {
    for (const beam of emitter.beams) {
      const relX = px - beam.originX
      const relY = py - beam.originY
      const along = relX * beam.dirX + relY * beam.dirY
      if (along < 0 || along > beam.beamLength) continue
      const off = Math.abs(relX * beam.dirY - relY * beam.dirX)
      // Both falloffs are zero outside the glow radius, so the pow() below would contribute nothing.
      if (off >= glowDenom && off >= beamDenom) continue
      const fade = Math.pow(Math.max(0, 1 - along / beam.fadeDenom), 0.22)
      const glow = Math.max(0, 1 - off / glowDenom) * fade * cfg.intensity * 0.08
      const core = Math.max(0, 1 - off / beamDenom) * fade * cfg.intensity * 0.42
      const alpha = (glow + core) * beam.colorScale
      r += beam.color[0] * alpha
      g += beam.color[1] * alpha
      b += beam.color[2] * alpha
    }
    const emitterDist = Math.hypot(px - emitter.originX, py - emitter.originY)
    const emitterGlow = Math.pow(Math.max(0, 1 - emitterDist / emitterGlowDenom), 2) * cfg.intensity * 0.18
    r += emitter.color[0] * emitterGlow
    g += emitter.color[1] * emitterGlow
    b += emitter.color[2] * emitterGlow
  }
  out[0] = clamp255(r)
  out[1] = clamp255(g)
  out[2] = clamp255(b)
}

function fillBackground(data: Uint8ClampedArray, color: [number, number, number]): void {
  for (let i = 0; i < data.length; i += 4) {
    data[i] = color[0]
    data[i + 1] = color[1]
    data[i + 2] = color[2]
    data[i + 3] = 255
  }
}

function clamp255(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.trim().replace('#', '')
  const expanded = normalized.length === 3
    ? normalized.split('').map((part) => part + part).join('')
    : normalized
  const value = parseInt(expanded, 16)
  if (!Number.isFinite(value)) return [255, 255, 255]
  return [
    (value >> 16) & 0xff,
    (value >> 8) & 0xff,
    value & 0xff,
  ]
}
