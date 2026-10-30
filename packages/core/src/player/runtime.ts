import type {
  AssetManager,
  BufferPool,
  Demo,
  DemoModifier,
  DemoNode,
  Modifier,
  NodeContext,
  Scene,
  SceneNode,
  Signal,
} from '@overscan/types'
import {
  buildDemoRuntimeSections,
  renderDemoBuffer,
  type DemoFrameResult,
  type DemoRuntimeSection,
} from '../../../sequencer/dist/index.js'
import { GraphExecutor, type ExecutorProfiler } from '../graph/executor.js'
import { renderSceneFrame, type RenderFrameOptions, type RenderedFrame } from './render-frame.js'
import { RocketTimeline } from '../timeline/rocket.js'
import { createAssetManager, type AssetManagerOptions } from '../scene/asset-manager.js'

export interface SceneRuntime {
  scene: Scene
  timeline: RocketTimeline
  executor: GraphExecutor
  outputNodeId: string
  assets: AssetManager
}

export interface DemoRuntimeDocument {
  demo: Demo
  sections: DemoRuntimeSection<SceneRuntime>[]
  demoModifiers: Modifier[]
  fps: number
  duration: number
  resolution: { width: number; height: number }
}

export type RuntimeRegistryFactory = (nodes: SceneNode[]) => Map<string, DemoNode>

export interface CreateSceneRuntimeOptions {
  sinkId: string
  buildRegistry: RuntimeRegistryFactory
  assetManager: AssetManagerOptions
}

export interface CreateDemoRuntimeDocumentOptions {
  sinkId: string
  buildRegistry: RuntimeRegistryFactory
  assetManager: AssetManagerOptions
  /**
   * Asset options for one section, given its scene path. Use it to resolve a scene's relative asset
   * paths (shaders, textures) against that scene file rather than the demo file. Defaults to `assetManager`.
   */
  sectionAssetManager?: (scenePath: string) => AssetManagerOptions
  loadSection: (
    scenePath: string,
    section: Demo['sections'][number],
    index: number,
  ) => Promise<{ scene: Scene; scenePath?: string }>
}

export function buildDemoModifierStack(
  entries: DemoModifier[] | undefined,
  buildRegistry: RuntimeRegistryFactory,
): Modifier[] {
  const enabledEntries = (entries ?? []).filter(entry => entry.enabled !== false)
  if (enabledEntries.length === 0) return []
  const nodes: SceneNode[] = enabledEntries.map((entry, index) => ({
    id: entry.id || `demoModifier${index + 1}`,
    type: 'modifier',
    impl: entry.impl,
    config: entry.config ?? {},
  }))
  const registry = buildRegistry(nodes)
  return nodes
    .map(node => registry.get(node.id))
    .filter((candidate): candidate is Modifier => candidate?.type === 'modifier')
}

export function applyModifierStack(
  ctx: NodeContext,
  pool: BufferPool,
  buffer: ReturnType<BufferPool['acquire']>,
  signal: RenderedFrame['signal'],
  modifiers: Modifier[],
): ReturnType<BufferPool['acquire']> {
  if (modifiers.length === 0) return buffer
  let current = buffer
  for (let index = 0; index < modifiers.length; index += 1) {
    const next = pool.acquire(current.width, current.height)
    modifiers[index]!.apply(ctx, current, next, signal)
    if (current !== buffer) pool.release(current)
    current = next
  }
  return current
}

export async function createSceneRuntime(
  scene: Scene,
  options: CreateSceneRuntimeOptions,
): Promise<SceneRuntime> {
  const timeline = new RocketTimeline()
  timeline.load(scene.tracks)
  const assets = createAssetManager(options.assetManager)
  await assets.preloadScene(scene)
  const executor = new GraphExecutor()
  executor.load(scene.graph, options.buildRegistry(scene.graph.nodes))
  const outputNodeId = scene.graph.outputs[options.sinkId] ?? scene.graph.nodes[0]?.id
  if (!outputNodeId) throw new Error(`Scene has no output node for sink '${options.sinkId}'`)
  return { scene, timeline, executor, outputNodeId, assets }
}

export async function createDemoRuntimeDocument(
  demo: Demo,
  options: CreateDemoRuntimeDocumentOptions,
): Promise<DemoRuntimeDocument> {
  const { sections, fps, resolution } = await buildDemoRuntimeSections(
    demo,
    async (scenePath: string, section: Demo['sections'][number], index: number) => {
    const loaded = await options.loadSection(scenePath, section, index)
    const resolvedScenePath = loaded.scenePath ?? scenePath
    return {
      scene: loaded.scene,
      scenePath: resolvedScenePath,
      runtime: await createSceneRuntime(loaded.scene, {
        sinkId: options.sinkId,
        buildRegistry: options.buildRegistry,
        assetManager: options.sectionAssetManager?.(resolvedScenePath) ?? options.assetManager,
      }),
    }
    },
  )
  return {
    demo,
    sections,
    demoModifiers: buildDemoModifierStack(demo.modifiers, options.buildRegistry),
    fps,
    duration: sections.at(-1)?.end ?? 0,
    resolution,
  }
}

export function renderSceneRuntimeFrame(
  runtime: SceneRuntime,
  player: {
    pool: BufferPool
    ctx: NodeContext
    t: number
    frame: number
    dt: number
    profiler?: ExecutorProfiler
    options?: RenderFrameOptions
  },
): RenderedFrame {
  player.ctx.assets = runtime.assets
  return renderSceneFrame({
    scene: runtime.scene,
    timeline: runtime.timeline,
    executor: runtime.executor,
    pool: player.pool,
    ctx: player.ctx,
    outputNodeId: runtime.outputNodeId,
  }, player.t, player.frame, player.dt, player.profiler, player.options)
}

export function renderDemoRuntimeFrame(
  document: Pick<DemoRuntimeDocument, 'sections' | 'demoModifiers'>,
  args: {
    pool: BufferPool
    ctx: NodeContext
    t: number
    frame: number
    dt: number
    profiler?: ExecutorProfiler
    options?: RenderFrameOptions
  },
): DemoFrameResult<ReturnType<BufferPool['acquire']>, Signal> | null {
  const rendered = renderDemoBuffer<SceneRuntime, ReturnType<BufferPool['acquire']>, Signal, NodeContext, RenderFrameOptions>({
    pool: args.pool,
    ctx: args.ctx,
    sections: document.sections,
    t: args.t,
    frame: args.frame,
    dt: args.dt,
    ...(args.options !== undefined ? { options: args.options } : {}),
    setContextAssets(localCtx: NodeContext, runtime: SceneRuntime) {
      localCtx.assets = runtime.assets
    },
    renderSection(
      runtime: SceneRuntime,
      localTime: number,
      localFrame: number,
      localDt: number,
      options?: RenderFrameOptions,
    ) {
      return renderSceneRuntimeFrame(runtime, {
        pool: args.pool,
        ctx: args.ctx,
        t: localTime,
        frame: localFrame,
        dt: localDt,
        ...(args.profiler !== undefined ? { profiler: args.profiler } : {}),
        ...(options !== undefined ? { options } : {}),
      })
    },
  })
  if (!rendered || document.demoModifiers.length === 0) return rendered
  const output = applyModifierStack(args.ctx, args.pool, rendered.buffer, rendered.signal, document.demoModifiers)
  if (output === rendered.buffer) return rendered
  args.pool.release(rendered.buffer)
  return {
    ...rendered,
    buffer: output,
  }
}
