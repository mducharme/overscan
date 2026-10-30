import type { BufferPool, FrameBuffer, NodeContext, Scene, Signal } from '@overscan/types'
import {
  renderDemoRuntimeFrame,
  renderSceneRuntimeFrame,
  type DemoRuntimeDocument,
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
  readonly sections: readonly PlayerSection[]
  sectionAt(t: number): PlayerSection | undefined
  /** Prepare every section's nodes for this context (call again after the output size changes). */
  init(ctx: NodeContext): void
  render(pool: BufferPool, ctx: NodeContext, t: number, frame: number, dt: number): RenderedFrame | null
  destroy(): void
}

export function createScenePlayer(scene: Scene, scenePath: string, runtime: SceneRuntime): Player {
  const section: PlayerSection = {
    id: scene.id,
    title: scene.title,
    start: 0,
    end: scene.duration,
    scenePath,
    scene,
    transition: { type: 'cut', duration: 0 },
  }
  return {
    duration: scene.duration,
    fps: scene.fps,
    resolution: scene.resolution,
    sections: [section],
    sectionAt: t => (t >= 0 && t <= scene.duration ? section : undefined),
    init(ctx) {
      ctx.assets = runtime.assets
      runtime.executor.init(ctx)
    },
    render(pool, ctx, t, frame, dt) {
      return renderSceneRuntimeFrame(runtime, { pool, ctx, t, frame, dt })
    },
    destroy() {
      runtime.executor.destroy()
    },
  }
}

export function createDemoPlayer(document: DemoRuntimeDocument): Player {
  const sections: PlayerSection[] = document.sections.map(section => ({
    id: section.id,
    title: section.runtime.scene.title,
    start: section.start,
    end: section.end,
    scenePath: section.scenePath,
    scene: section.runtime.scene,
    transition: { type: section.transitionType, duration: section.transitionDuration },
  }))
  return {
    duration: document.duration,
    fps: document.fps,
    resolution: document.resolution,
    sections,
    // The latest section that has started wins, so a transition overlap reports the incoming section.
    sectionAt: t => [...sections].reverse().find(s => t >= s.start && t < s.end),
    init(ctx) {
      for (const section of document.sections) {
        ctx.assets = section.runtime.assets
        section.runtime.executor.init(ctx)
      }
    },
    render(pool, ctx, t, frame, dt) {
      return renderDemoRuntimeFrame(document, { pool, ctx, t, frame, dt })
    },
    destroy() {
      for (const section of document.sections) section.runtime.executor.destroy()
    },
  }
}
