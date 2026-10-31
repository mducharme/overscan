import type { BufferPool, FrameBuffer, NodeContext, Scene, Signal } from '@overscan/types'
import {
  GraphExecutor,
  renderDemoRuntimeFrame,
  renderSceneRuntimeFrame,
  type DemoRuntimeDocument,
  type RuntimeRegistryFactory,
  type SceneRuntime,
} from '@overscan/core/browser'

/** One stretch of the timeline: the whole scene for a scene file, or one demo section. */
export interface PlayerSection {
  id: string
  title: string
  start: number
  end: number
  scenePath: string
  scene: Scene
  /** Transition into the next section ('cut' when none). */
  transition: { type: string; duration: number }
}

export interface RenderedFrame {
  buffer: FrameBuffer
  signal: Signal
}

/** Scenes and demos behind one interface, so the UI never branches on the file type. */
export interface Player {
  readonly duration: number
  readonly fps: number
  readonly resolution: { width: number; height: number }
  /** Replaced (new array, new objects for changed sections) whenever a scene is updated. */
  readonly sections: readonly PlayerSection[]
  /** Bumped whenever an update changes what renders (scene swapped in, nodes rebuilt). */
  readonly version: number
  sectionAt(t: number): PlayerSection | undefined
  /** Prepare every section's nodes for this context (call again after the output size changes). */
  init(ctx: NodeContext): void
  /** Renders time `t`. Node failures throw (strict), so the UI can report them instead of drawing a placeholder. */
  render(pool: BufferPool, ctx: NodeContext, t: number, frame: number, dt: number): RenderedFrame | null
  /**
   * Swaps in an edited version of the scene at `scenePath`. Sections show it immediately; the nodes are
   * rebuilt in the background (bursts of updates coalesce into one rebuild) and initialised on the next
   * render. Rejects if the new graph cannot be built; the previous nodes keep rendering.
   */
  updateScene(scenePath: string, scene: Scene): Promise<void>
  destroy(): void
}

interface RuntimeSlot {
  scenePath: string
  runtime: SceneRuntime
}

/**
 * The shared part of both players: section bookkeeping plus rebuilding runtimes in place. Runtimes are
 * mutated rather than replaced because the core renderers hold on to the runtime objects.
 */
function createPlayerCore(slots: RuntimeSlot[], initialSections: PlayerSection[], buildRegistry: RuntimeRegistryFactory) {
  let sections = initialSections
  let version = 0
  const needsInit = new Set<SceneRuntime>()
  const retired: GraphExecutor[] = []
  const pending = new Map<string, { scene: Scene; waiters: { resolve: () => void; reject: (e: unknown) => void }[] }>()
  let running: Promise<void> | null = null

  const rebuild = async (scenePath: string, scene: Scene): Promise<void> => {
    for (const slot of slots) {
      if (slot.scenePath !== scenePath) continue
      const { runtime } = slot
      const executor = new GraphExecutor()
      executor.load(scene.graph, buildRegistry(scene.graph.nodes))
      await runtime.assets.preloadScene(scene)
      retired.push(runtime.executor)
      runtime.executor = executor
      runtime.scene = scene
      runtime.timeline.load(scene.tracks)
      runtime.outputNodeId = scene.graph.outputs.browser ?? scene.graph.nodes[0]?.id ?? runtime.outputNodeId
      needsInit.add(runtime)
    }
    version++
  }

  const drain = async (): Promise<void> => {
    while (pending.size > 0) {
      const [scenePath, job] = pending.entries().next().value as [string, { scene: Scene; waiters: { resolve: () => void; reject: (e: unknown) => void }[] }]
      pending.delete(scenePath)
      try {
        await rebuild(scenePath, job.scene)
        for (const w of job.waiters) w.resolve()
      } catch (error) {
        for (const w of job.waiters) w.reject(error)
      }
    }
    running = null
  }

  return {
    get sections() { return sections },
    get version() { return version },
    updateScene(scenePath: string, scene: Scene): Promise<void> {
      sections = sections.map(s => (s.scenePath === scenePath ? { ...s, scene, title: scene.title } : s))
      return new Promise<void>((resolve, reject) => {
        const job = pending.get(scenePath)
        // A newer edit replaces an unstarted one; everyone waiting is answered by the newest rebuild.
        pending.set(scenePath, { scene, waiters: [...(job?.waiters ?? []), { resolve, reject }] })
        running ??= drain()
      })
    },
    /** Initialise rebuilt runtimes and free replaced executors, inside a render (GL context current). */
    prepare(ctx: NodeContext): void {
      for (const executor of retired.splice(0)) executor.destroy()
      for (const runtime of needsInit) {
        ctx.assets = runtime.assets
        runtime.executor.init(ctx)
      }
      needsInit.clear()
    },
    destroy(): void {
      for (const executor of retired.splice(0)) executor.destroy()
      needsInit.clear()
    },
  }
}

export function createScenePlayer(scene: Scene, scenePath: string, runtime: SceneRuntime, buildRegistry: RuntimeRegistryFactory): Player {
  const core = createPlayerCore([{ scenePath, runtime }], [{
    id: scene.id,
    title: scene.title,
    start: 0,
    end: scene.duration,
    scenePath,
    scene,
    transition: { type: 'cut', duration: 0 },
  }], buildRegistry)
  return {
    duration: scene.duration,
    fps: scene.fps,
    resolution: scene.resolution,
    get sections() { return core.sections },
    get version() { return core.version },
    sectionAt: t => (t >= 0 && t <= scene.duration ? core.sections[0] : undefined),
    init(ctx) {
      ctx.assets = runtime.assets
      runtime.executor.init(ctx)
    },
    render(pool, ctx, t, frame, dt) {
      core.prepare(ctx)
      return renderSceneRuntimeFrame(runtime, { pool, ctx, t, frame, dt, options: { strictErrors: true } })
    },
    updateScene: (path, next) => core.updateScene(path, next),
    destroy() {
      core.destroy()
      runtime.executor.destroy()
    },
  }
}

export function createDemoPlayer(document: DemoRuntimeDocument, buildRegistry: RuntimeRegistryFactory): Player {
  const core = createPlayerCore(
    document.sections.map(s => ({ scenePath: s.scenePath, runtime: s.runtime })),
    document.sections.map(section => ({
      id: section.id,
      title: section.runtime.scene.title,
      start: section.start,
      end: section.end,
      scenePath: section.scenePath,
      scene: section.runtime.scene,
      transition: { type: section.transitionType, duration: section.transitionDuration },
    })),
    buildRegistry,
  )
  return {
    duration: document.duration,
    fps: document.fps,
    resolution: document.resolution,
    get sections() { return core.sections },
    get version() { return core.version },
    // The latest section that has started wins, so a transition overlap reports the incoming section.
    sectionAt: t => [...core.sections].reverse().find(s => t >= s.start && t < s.end),
    init(ctx) {
      for (const section of document.sections) {
        ctx.assets = section.runtime.assets
        section.runtime.executor.init(ctx)
      }
    },
    render(pool, ctx, t, frame, dt) {
      core.prepare(ctx)
      return renderDemoRuntimeFrame(document, { pool, ctx, t, frame, dt, options: { strictErrors: true } })
    },
    updateScene: (path, next) => core.updateScene(path, next),
    destroy() {
      core.destroy()
      for (const section of document.sections) section.runtime.executor.destroy()
    },
  }
}
