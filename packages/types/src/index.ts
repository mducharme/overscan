// ─── AnimatableFloat ──────────────────────────────────────────────────────────
//
// Any numeric parameter on any node. Resolved by the compositor before each
// node executes. Literals pass through. Track refs are looked up in
// signal.tracks. Node output refs resolve from the signal source tick map.

export type AnimatableFloat =
  | number
  | { track: string }                    // Rocket track reference
  | { node: string; output: string }     // signal source output reference

// ─── BlendMode ────────────────────────────────────────────────────────────────

export type BlendMode =
  | 'alpha'        // standard over compositing
  | 'additive'     // src + dst — fire, glow, sparks
  | 'multiply'     // src × dst — masks, tone maps
  | 'screen'       // 1-(1-s)(1-d) — light leaks, brightening
  | 'overlay'      // multiply darks, screen lights
  | 'difference'   // |src - dst| — transitions, psychedelic
  | 'mask'         // dst opacity modulated by src luminance

// ─── FrameBuffer ──────────────────────────────────────────────────────────────
//
// Owned by the buffer pool. Nodes borrow for one frame tick then return.
// Persistent nodes (fire, feedback) own their buffers permanently via
// persistent: true — they never return to the pool.
//
// GPU path populates texture + fbo. CPU nodes only touch data.

export interface FrameBuffer {
  readonly id: string
  readonly width: number
  readonly height: number
  data: Uint8ClampedArray
  texture?: WebGLTexture
  fbo?: WebGLFramebuffer
  clear(): void
}

// ─── BufferPool ───────────────────────────────────────────────────────────────

export interface BufferPool {
  acquire(width: number, height: number): FrameBuffer
  release(buffer: FrameBuffer): void
  retain(buffer: FrameBuffer): void   // increment ref count (diamond dependency support)
}

// ─── Signal ───────────────────────────────────────────────────────────────────
//
// Passed to every node on every frame. Constructed by the compositor from the
// clock, Rocket track values, and signal source tick outputs.

export interface Signal {
  // time
  t: number             // elapsed seconds since demo start
  frame: number         // absolute frame count
  dt: number            // delta since last frame in seconds

  // timeline
  beat: number          // current beat (fractional = sub-beat position)
  bpm: number           // master BPM

  // audio (populated by AudioAnalyser signal source node)
  rms: number           // overall loudness 0–1
  spectral: number      // spectral centroid / brightness 0–1
  chroma: Float32Array  // 12 pitch-class values
  mfcc: Float32Array    // 13 frequency band coefficients

  // Rocket-compatible named float tracks — resolved each frame
  tracks: Readonly<Record<string, number>>

  // signal source outputs — keyed by `${nodeId}.${outputName}`
  sources: Readonly<Record<string, number>>
}

export interface LoadedImageAsset {
  width: number
  height: number
  data: Uint8ClampedArray
}

export interface AssetManager {
  preloadScene(scene: Scene): Promise<void>
  getText(url: string): string | undefined
  getImage(url: string): LoadedImageAsset | undefined
  getError(url: string): string | undefined
}

// ─── NodeContext ──────────────────────────────────────────────────────────────

export interface NodeContext {
  canvas: OffscreenCanvas | null
  ctx2d: OffscreenCanvasRenderingContext2D | null
  gl: WebGL2RenderingContext | null
  assets?: AssetManager
  pool: BufferPool
  width: number
  height: number
}

// ─── Generator ────────────────────────────────────────────────────────────────

export interface Generator {
  readonly type: 'generator'
  readonly id: string
  resolution?: { width: number; height: number }
  renderers: ('gpu' | 'cpu')[]
  config: Record<string, AnimatableFloat | unknown>
  init(ctx: NodeContext): void
  render(ctx: NodeContext, out: FrameBuffer, signal: Signal): void
  glsl?: string
  uniforms?(signal: Signal): Record<string, unknown>
  destroy(): void
}

// ─── Modifier ─────────────────────────────────────────────────────────────────

export interface Modifier {
  readonly type: 'modifier'
  readonly id: string
  readonly persistent: boolean   // true = owns permanent buffer (feedback, fire)
  config: Record<string, AnimatableFloat | unknown>
  init(ctx: NodeContext): void
  apply(ctx: NodeContext, input: FrameBuffer, out: FrameBuffer, signal: Signal): void
  // Exposed as a function not a program — enables GPU pass merging
  glsl?: string
  destroy(): void
}

// ─── Compositor edge meta (CPU sampling) ─────────────────────────────────────

export interface CompositorEdgeTransform {
  position: [number, number]
  scale: [number, number]
  rotation?: number
}

export interface CompositorInputMeta {
  transform?: CompositorEdgeTransform
}

// ─── Compositor ───────────────────────────────────────────────────────────────
//
// Always has 'base' and 'overlay' inputs. 'mask' is optional — when connected,
// overlay opacity is modulated per-pixel by the mask buffer's luminance.

export interface Compositor {
  readonly type: 'compositor'
  readonly id: string
  readonly inputs: readonly string[]
  mode: BlendMode
  opacity: AnimatableFloat
  config: Record<string, AnimatableFloat | unknown>
  init(ctx: NodeContext): void
  compose(
    ctx: NodeContext,
    inputs: Readonly<Record<string, FrameBuffer>>,
    out: FrameBuffer,
    signal: Signal,
    inputMeta?: Readonly<Record<string, CompositorInputMeta>>,
  ): void
  glsl?: string
  destroy(): void
}

// ─── SignalSource ─────────────────────────────────────────────────────────────
//
// No visual output. Produces named float values consumed by AnimatableFloat
// params anywhere in the graph. tick() runs before the render pass each frame.
// Outputs written into signal.sources as `${id}.${outputName}`.

export interface SignalSource {
  readonly type: 'signal'
  readonly id: string
  readonly outputs: readonly string[]
  config: Record<string, unknown>
  init(ctx: NodeContext): void
  tick(signal: Signal): Record<string, number>
  destroy(): void
}

// ─── DemoNode union ───────────────────────────────────────────────────────────

export type DemoNode = Generator | Modifier | Compositor | SignalSource

// ─── Scene graph ──────────────────────────────────────────────────────────────

export interface SceneNode {
  id: string
  type: 'generator' | 'modifier' | 'compositor' | 'signal'
  impl: string
  config: Record<string, AnimatableFloat | unknown>
  resolution?: { width: number; height: number }
  startTime?: number
  endTime?: number
}

export interface SceneEdge {
  from: { node: string; output: string }
  to:   { node: string; input: string }
  z?: number
  transform?: CompositorEdgeTransform
}

export interface SceneGraph {
  nodes: SceneNode[]
  edges: SceneEdge[]
  // Maps sink id → node id. Different sinks can consume different nodes.
  outputs: Record<string, string>
}

// ─── Rocket timeline ──────────────────────────────────────────────────────────

/** Extended set (improvement plan §3.1) — ship all names; some map to baseline until tuned. */
export type RocketInterpolation =
  | 'step'
  | 'linear'
  | 'smooth'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | 'elastic'
  | 'bounce'
  | 'back'
  | 'expo-in'
  | 'expo-out'

export interface ClockOptions {
  /** Start timeline from this many seconds in. */
  seek?: number
  /** Playback rate (0 = paused, 0.25 = quarter speed, 1 = normal). */
  rate?: number
  /** Optional loop range in seconds. */
  loop?: [number, number]
}

export interface Clock {
  currentTime(): number
  isPaused(): boolean
  getRate(): number
  seek(t: number): void
  pause(): void
  play(): void
  setRate(rate: number): void
}

export interface RocketKey {
  row: number
  value: number
  interpolation: RocketInterpolation
}

export interface RocketTrack {
  name: string
  keys: RocketKey[]
}

// ─── Scene ────────────────────────────────────────────────────────────────────

export interface Scene {
  id: string
  title: string
  duration: number
  bpm: number
  rowsPerBeat: number             // default 8
  audio?: AudioClip | string
  resolution: { width: number; height: number }
  fps: number
  tracks: RocketTrack[]
  graph: SceneGraph
}

export interface AudioClip {
  src: string
  volume?: number
  /** First-pass pitch control; currently maps to playback-rate style behavior. */
  pitch?: number
}

export interface DemoTransition {
  type: 'cut' | 'dissolve' | 'wipe-left' | 'wipe-right' | 'wipe-up' | 'wipe-down' | 'zoom-out' | 'flash' | 'iris'
  duration?: number
  easing?: RocketInterpolation
  flashColor?: string
}

export interface DemoSection {
  id: string
  scene: string
  duration?: number
  transition?: DemoTransition
}

export interface DemoModifier {
  id: string
  impl: string
  enabled?: boolean
  config: Record<string, AnimatableFloat | unknown>
}

export interface Demo {
  id: string
  title: string
  audio?: AudioClip | string
  loop?: boolean
  modifiers?: DemoModifier[]
  sections: DemoSection[]
}

// ─── Sink ─────────────────────────────────────────────────────────────────────

export interface Sink {
  readonly id: string
  init(width: number, height: number, fps: number): Promise<void>
  write(frame: FrameBuffer, frameIndex: number, signal: Signal): Promise<void>
  flush(): Promise<void>
}

// ─── Terminal sink options ────────────────────────────────────────────────────

export type TerminalMode = 'sixel' | 'ansi' | 'ascii'

export interface TerminalSinkOptions {
  mode?: TerminalMode
  fpsCap?: number
  fullscreen?: boolean
  noDisplay?: boolean
  /** Called when the terminal size may have changed (SIGWINCH / stdout resize). */
  onResize?: () => void
}

/** Resolve a literal, Rocket track ref, or signal-node output ref to a number. */
export function resolveAnimatableFloat(v: AnimatableFloat | unknown, signal: Signal): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (v && typeof v === 'object') {
    if ('track' in v && typeof (v).track === 'string') {
      return signal.tracks[(v as { track: string }).track] ?? 0
    }
    if (
      'node' in v &&
      'output' in v &&
      typeof (v as { node: unknown }).node === 'string' &&
      typeof (v as { output: unknown }).output === 'string'
    ) {
      const key = `${(v as { node: string }).node}.${(v as { output: string }).output}`
      return signal.sources[key] ?? 0
    }
  }
  return 0
}

// ─── Compositor options ───────────────────────────────────────────────────────

export interface CompositorOptions {
  renderer: 'cpu' | 'gpu'
}

/**
 * Returns a freshly created WebGL object, or throws `message` when creation failed. WebGL's create*
 * calls return null (for example after a lost context), though the DOM typings declare them non-null.
 */
export function requireGlObject<T>(value: T | null, message: string): T {
  if (value === null) throw new Error(message)
  return value
}
