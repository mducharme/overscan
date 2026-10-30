import type { Demo, DemoSection, DemoTransition, RocketInterpolation } from '@overscan/types'

export type { Demo, DemoSection, DemoTransition } from '@overscan/types'

export interface DemoSceneLike {
  duration: number
  fps: number
  resolution: { width: number; height: number }
}

export interface DemoRuntimeSection<TRuntime> {
  id: string
  start: number
  end: number
  scenePath: string
  runtime: TRuntime
  transitionType: DemoTransition['type']
  transitionDuration: number
  transitionEasing: RocketInterpolation
  transitionFlashColor: [number, number, number]
}

export interface DemoSectionsResult<TRuntime> {
  sections: DemoRuntimeSection<TRuntime>[]
  fps: number
  resolution: { width: number; height: number }
}

export interface DemoBufferLike {
  width: number
  height: number
  data: Uint8ClampedArray
  texture?: WebGLTexture
  fbo?: WebGLFramebuffer
}

export interface DemoPoolLike<TBuffer extends DemoBufferLike> {
  acquire(width: number, height: number): TBuffer
  release(buffer: TBuffer): void
}

export interface DemoRenderContextLike {
  gl: WebGL2RenderingContext | null
  width: number
  height: number
  assets?: unknown
}

export interface DemoFrameResult<TBuffer extends DemoBufferLike, TSignal> {
  buffer: TBuffer
  signal: TSignal
}

export interface RenderDemoBufferArgs<
  TRuntime,
  TBuffer extends DemoBufferLike,
  TSignal,
  TContext extends DemoRenderContextLike,
  TOptions,
> {
  pool: DemoPoolLike<TBuffer>
  ctx: TContext
  sections: DemoRuntimeSection<TRuntime>[]
  t: number
  frame: number
  dt: number
  options?: TOptions
  renderSection: (
    runtime: TRuntime,
    localTime: number,
    frame: number,
    dt: number,
    options?: TOptions,
  ) => DemoFrameResult<TBuffer, TSignal>
  setContextAssets?: (ctx: TContext, runtime: TRuntime) => void
}

export function smoothstep(t: number): number {
  return t * t * (3 - 2 * t)
}

export function smoothstepRange(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / Math.max(0.0001, b - a)))
  return smoothstep(t)
}

function cubicIn(t: number): number {
  return t * t * t
}

function cubicOut(t: number): number {
  const u = 1 - t
  return 1 - u * u * u
}

function cubicInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function elastic(t: number): number {
  if (t === 0 || t === 1) return t
  const p = 0.3
  const s = p / 4
  return Math.pow(2, -10 * t) * Math.sin(((t - s) * (Math.PI * 2)) / p) + 1
}

function bounce(t: number): number {
  const n1 = 7.5625
  const d1 = 2.75
  if (t < 1 / d1) return n1 * t * t
  if (t < 2 / d1) return n1 * (t - 1.5 / d1) * (t - 1.5 / d1) + 0.75
  if (t < 2.5 / d1) return n1 * (t - 2.25 / d1) * (t - 2.25 / d1) + 0.9375
  return n1 * (t - 2.625 / d1) * (t - 2.625 / d1) + 0.984375
}

function back(t: number): number {
  const c1 = 1.70158
  const c3 = c1 + 1
  return c3 * t * t * t - c1 * t * t
}

function expoIn(t: number): number {
  return t === 0 ? 0 : Math.pow(2, 10 * t - 10)
}

function expoOut(t: number): number {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t)
}

export function easeValue(t: number, mode: RocketInterpolation): number {
  const x = Math.min(1, Math.max(0, t))
  switch (mode) {
    case 'step': return 0
    case 'linear': return x
    case 'smooth': return smoothstep(x)
    case 'ease-in': return cubicIn(x)
    case 'ease-out': return cubicOut(x)
    case 'ease-in-out': return cubicInOut(x)
    case 'elastic': return elastic(x)
    case 'bounce': return bounce(x)
    case 'back': return back(x)
    case 'expo-in': return expoIn(x)
    case 'expo-out': return expoOut(x)
    default: return x
  }
}

export function hexToRgb(hex: string): [number, number, number] {
  const s = hex.replace('#', '')
  const expanded = s.length === 3 ? s.split('').map(c => c + c).join('') : s
  const n = parseInt(expanded, 16)
  return [
    Number.isFinite(n) ? (n >> 16) & 0xff : 255,
    Number.isFinite(n) ? (n >> 8) & 0xff : 255,
    Number.isFinite(n) ? n & 0xff : 255,
  ]
}

export async function buildDemoRuntimeSections<TRuntime>(
  demo: Demo,
  loadSection: (
    scenePath: string,
    section: DemoSection,
    index: number,
  ) => Promise<{ scene: DemoSceneLike; runtime: TRuntime; scenePath?: string }>,
): Promise<DemoSectionsResult<TRuntime>> {
  const sections: DemoRuntimeSection<TRuntime>[] = []
  let cursor = 0
  let baseFps = 0
  let baseResolution: { width: number; height: number } | null = null

  for (let i = 0; i < demo.sections.length; i++) {
    const section = demo.sections[i]!
    const loaded = await loadSection(section.scene, section, i)
    const scene = loaded.scene
    if (baseFps === 0) baseFps = scene.fps
    baseResolution ??= scene.resolution
    if (scene.fps !== baseFps) {
      throw new Error(`Demo section '${section.id}' fps ${scene.fps} does not match ${baseFps}`)
    }
    if (
      scene.resolution.width !== baseResolution.width ||
      scene.resolution.height !== baseResolution.height
    ) {
      throw new Error(
        `Demo section '${section.id}' resolution ${scene.resolution.width}x${scene.resolution.height} ` +
        `does not match ${baseResolution.width}x${baseResolution.height}`,
      )
    }
    const duration = section.duration ?? scene.duration
    const transitionType = section.transition?.type ?? 'cut'
    const transitionDuration = transitionType === 'cut'
      ? 0
      : Math.min(section.transition?.duration ?? 0, duration)
    const start = i === 0 ? 0 : cursor
    const end = start + duration
    sections.push({
      id: section.id,
      start,
      end,
      scenePath: loaded.scenePath ?? section.scene,
      runtime: loaded.runtime,
      transitionType,
      transitionDuration,
      transitionEasing: section.transition?.easing ?? 'smooth',
      transitionFlashColor: hexToRgb(section.transition?.flashColor ?? '#ffffff'),
    })
    cursor = end - transitionDuration
  }

  if (!baseResolution) throw new Error(`Demo '${demo.id}' has no sections`)
  return { sections, fps: baseFps, resolution: baseResolution }
}

export function findActiveDemoSectionIndex<TRuntime>(
  sections: DemoRuntimeSection<TRuntime>[],
  t: number,
): number {
  return sections.findIndex(section => t >= section.start && t < section.end)
}

export function transitionMix(mode: DemoTransition['type'], p: number, uvx: number, uvy: number): number {
  switch (mode) {
    case 'wipe-left':
      return uvx <= p ? 1 : 0
    case 'wipe-right':
      return uvx >= 1 - p ? 1 : 0
    case 'wipe-up':
      return uvy <= p ? 1 : 0
    case 'wipe-down':
      return uvy >= 1 - p ? 1 : 0
    case 'zoom-out': {
      const dx = uvx - 0.5
      const dy = uvy - 0.5
      const dist = Math.sqrt(dx * dx + dy * dy)
      const radius = (1 - p) * 0.78
      const feather = 0.12 + (1 - p) * 0.04
      return smoothstepRange(radius - feather, radius + 0.02, dist)
    }
    case 'iris': {
      const dx = uvx - 0.5
      const dy = uvy - 0.5
      return Math.sqrt(dx * dx + dy * dy) <= p * 0.75 ? 1 : 0
    }
    case 'flash':
    case 'dissolve':
    default:
      return p
  }
}

export function mixDemoBuffers(
  dst: Uint8ClampedArray,
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  width: number,
  height: number,
  alpha: number,
  transitionType: DemoTransition['type'],
  flashColor: [number, number, number],
): void {
  const t = Math.max(0, Math.min(1, alpha))
  for (let i = 0; i < dst.length; i += 4) {
    const pixel = i / 4
    const uvx = (pixel % width) / Math.max(1, width - 1)
    const uvy = Math.floor(pixel / width) / Math.max(1, height - 1)
    if (transitionType === 'zoom-out') {
      const dx = uvx - 0.5
      const dy = uvy - 0.5
      const dist = Math.sqrt(dx * dx + dy * dy)
      const scale = Math.max(0.001, 1 - t * 0.985)
      const radius = scale * 0.78
      const feather = 0.08 + scale * 0.05
      let currentAlpha = 1 - smoothstepRange(radius - feather, radius + 0.02, dist)
      const srcU = dx / scale + 0.5
      const srcV = dy / scale + 0.5
      if (srcU < 0 || srcU > 1 || srcV < 0 || srcV > 1) currentAlpha = 0
      const current = sampleBuffer(a, width, height, srcU, srcV)
      const inv = 1 - currentAlpha
      dst[i] = Math.round((b[i] ?? 0) * inv + current[0] * currentAlpha)
      dst[i + 1] = Math.round((b[i + 1] ?? 0) * inv + current[1] * currentAlpha)
      dst[i + 2] = Math.round((b[i + 2] ?? 0) * inv + current[2] * currentAlpha)
      dst[i + 3] = Math.round((b[i + 3] ?? 255) * inv + current[3] * currentAlpha)
      continue
    }

    const k = transitionMix(transitionType, t, uvx, uvy)
    const u = 1 - k
    let r = Math.round((a[i] ?? 0) * u + (b[i] ?? 0) * k)
    let g = Math.round((a[i + 1] ?? 0) * u + (b[i + 1] ?? 0) * k)
    let bl = Math.round((a[i + 2] ?? 0) * u + (b[i + 2] ?? 0) * k)
    if (transitionType === 'flash') {
      const flash = Math.sin(t * Math.PI) * 0.7
      r = Math.round(r * (1 - flash) + flashColor[0] * flash)
      g = Math.round(g * (1 - flash) + flashColor[1] * flash)
      bl = Math.round(bl * (1 - flash) + flashColor[2] * flash)
    }
    dst[i] = r
    dst[i + 1] = g
    dst[i + 2] = bl
    dst[i + 3] = Math.round((a[i + 3] ?? 255) * u + (b[i + 3] ?? 255) * k)
  }
}

export function renderDemoBuffer<
  TRuntime,
  TBuffer extends DemoBufferLike,
  TSignal,
  TContext extends DemoRenderContextLike,
  TOptions = undefined,
>({
  pool,
  ctx,
  sections,
  t,
  frame,
  dt,
  options,
  renderSection,
  setContextAssets,
}: RenderDemoBufferArgs<TRuntime, TBuffer, TSignal, TContext, TOptions>): DemoFrameResult<TBuffer, TSignal> | null {
  const activeIdx = findActiveDemoSectionIndex(sections, t)
  if (activeIdx < 0) return null
  const active = sections[activeIdx]!
  setContextAssets?.(ctx, active.runtime)
  const primary = renderSection(active.runtime, Math.max(0, t - active.start), frame, dt, options)

  if (
    active.transitionType !== 'cut' &&
    active.transitionDuration > 0 &&
    activeIdx + 1 < sections.length &&
    t >= active.end - active.transitionDuration
  ) {
    const next = sections[activeIdx + 1]!
    setContextAssets?.(ctx, next.runtime)
    const nextFrame = renderSection(next.runtime, Math.max(0, t - next.start), frame, dt, options)
    syncBufferToCpu(ctx.gl, primary.buffer)
    syncBufferToCpu(ctx.gl, nextFrame.buffer)
    const mixed = pool.acquire(ctx.width, ctx.height)
    const alpha = easeValue(
      (t - (active.end - active.transitionDuration)) / active.transitionDuration,
      active.transitionEasing,
    )
    mixDemoBuffers(
      mixed.data,
      primary.buffer.data,
      nextFrame.buffer.data,
      ctx.width,
      ctx.height,
      alpha,
      active.transitionType,
      active.transitionFlashColor,
    )
    syncBufferToTexture(ctx.gl, mixed)
    pool.release(primary.buffer)
    pool.release(nextFrame.buffer)
    setContextAssets?.(ctx, active.runtime)
    return { buffer: mixed, signal: primary.signal }
  }

  return primary
}

function sampleBuffer(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  u: number,
  v: number,
): [number, number, number, number] {
  const x = Math.max(0, Math.min(width - 1, Math.round(u * (width - 1))))
  const y = Math.max(0, Math.min(height - 1, Math.round(v * (height - 1))))
  const i = (y * width + x) * 4
  return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0, data[i + 3] ?? 255]
}

function syncBufferToCpu(gl: WebGL2RenderingContext | null, buffer: DemoBufferLike): void {
  if (!gl || !buffer.fbo) return
  gl.bindFramebuffer(gl.FRAMEBUFFER, buffer.fbo)
  gl.readPixels(0, 0, buffer.width, buffer.height, gl.RGBA, gl.UNSIGNED_BYTE, buffer.data)
}

function syncBufferToTexture(gl: WebGL2RenderingContext | null, buffer: DemoBufferLike): void {
  if (!gl || !buffer.texture) return
  gl.bindTexture(gl.TEXTURE_2D, buffer.texture)
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    buffer.width,
    buffer.height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    buffer.data,
  )
}
