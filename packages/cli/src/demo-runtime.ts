import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { AssetManager, Demo, NodeContext, Scene } from '@overscan/types'
import {
  createAssetManager,
  GraphExecutor,
  renderSceneFrame,
  RocketTimeline
} from '@overscan/core'
import type { BufferPoolImpl ,
  SceneLoader} from '@overscan/core'
import {
  buildDemoRuntimeSections,
  renderDemoBuffer as renderSharedDemoBuffer,
  type DemoRuntimeSection,
} from '@overscan/sequencer'
import { buildRegistry } from './node-registry.js'

export interface SceneRuntime {
  scene: Scene
  timeline: RocketTimeline
  executor: GraphExecutor
  outputNodeId: string
  assets: AssetManager
}

export async function makeSceneRuntime(scene: Scene, sinkId: string, scenePath?: string): Promise<SceneRuntime> {
  const timeline = new RocketTimeline()
  timeline.load(scene.tracks)
  const assets = createAssetManager({
    resolveAssetUrl(url) {
      if (!scenePath || /^([a-z]+:)?\/\//i.test(url) || url.startsWith('overscan://')) return url
      return resolve(dirname(scenePath), url)
    },
    loadText(path) {
      return readFile(path, 'utf8')
    },
    loadBinary(path) {
      return readFile(path)
    },
  })
  await assets.preloadScene(scene)
  const registry = buildRegistry(scene.graph.nodes)
  const executor = new GraphExecutor()
  executor.load(scene.graph, registry)
  const outputNodeId = scene.graph.outputs[sinkId] ?? scene.graph.nodes[0]?.id
  if (!outputNodeId) throw new Error(`Scene has no output node for sink '${sinkId}'`)
  return { scene, timeline, executor, outputNodeId, assets }
}

export async function loadDemoRuntimeSections(
  loader: SceneLoader,
  demoPath: string,
  demo: Demo,
  sinkId: string,
): Promise<{ sections: DemoRuntimeSection<SceneRuntime>[]; fps: number; resolution: { width: number; height: number } }> {
  return buildDemoRuntimeSections(demo, async rawScenePath => {
    const scenePath = loader.resolveScenePath(demoPath, rawScenePath)
    const scene = await loader.loadFile(scenePath)
    return {
      scene,
      scenePath,
      runtime: await makeSceneRuntime(scene, sinkId, scenePath),
    }
  })
}

export function renderDemoBuffer(
  pool: BufferPoolImpl,
  ctx: NodeContext,
  sections: DemoRuntimeSection<SceneRuntime>[],
  t: number,
  frame: number,
  dt: number,
  options?: { strictErrors?: boolean },
): { buffer: ReturnType<BufferPoolImpl['acquire']>; signal: ReturnType<typeof renderSceneFrame>['signal'] } | null {
  return renderSharedDemoBuffer({
    pool,
    ctx,
    sections,
    t,
    frame,
    dt,
    options,
    setContextAssets(localCtx, runtime) {
      localCtx.assets = runtime.assets
    },
    renderSection(runtime, localTime, localFrame, localDt, renderOptions) {
      return renderSceneFrame({
        scene: runtime.scene,
        timeline: runtime.timeline,
        executor: runtime.executor,
        pool,
        ctx,
        outputNodeId: runtime.outputNodeId,
      }, localTime, localFrame, localDt, undefined, renderOptions)
    },
  })
}
