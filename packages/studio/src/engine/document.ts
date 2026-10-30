import type { AssetManager, Demo, LoadedImageAsset, Scene } from '@overscan/types'
import {
  createDemoRuntimeDocument,
  createSceneRuntime,
  parseDemoJson,
  parseSceneJson,
  type AssetManagerOptions,
} from '@overscan/core/browser'
import { buildBuiltinRegistry } from '@overscan/nodes/browser'
import type { Bridge } from './bridge'
import { isUrl, resolvePath } from './paths'
import { createDemoPlayer, createScenePlayer, type Player } from './player'

export type DocumentKind = 'scene' | 'demo'

/** A file (scene or demo) that failed to load or that references an asset that could not load. */
export interface AssetProblem {
  /** Scene file the reference appears in. */
  scenePath: string
  nodeId: string
  url: string
  message: string
}

export interface StudioDocument {
  kind: DocumentKind
  filePath: string
  text: string
  mtimeMs: number
  scene: Scene | null
  demo: Demo | null
  player: Player
  assetProblems: AssetProblem[]
}

export interface LoadOptions {
  /** Decodes image bytes (browser: createImageBitmap + canvas). Without it, image assets report an error. */
  decodeImage?: (bytes: Uint8Array) => Promise<LoadedImageAsset | undefined>
}

export function documentKind(filePath: string): DocumentKind {
  return filePath.endsWith('.demo.json') ? 'demo' : 'scene'
}

/** Asset options that resolve and read everything relative to `basePath` through the bridge. */
function assetOptions(bridge: Bridge, basePath: string, options: LoadOptions): AssetManagerOptions {
  return {
    resolveAssetUrl: url => (isUrl(url) ? url : resolvePath(basePath, url)),
    async loadText(path) {
      if (/^[a-z]+:\/\//i.test(path)) {
        const response = await fetch(path)
        if (!response.ok) throw new Error(`Fetching ${path} failed (${response.status})`)
        return response.text()
      }
      return (await bridge.read(path)).text
    },
    loadBinary: path => bridge.readBinary(path),
    ...(options.decodeImage ? { decodeImage: options.decodeImage } : {}),
  }
}

/** Asset load errors for every string value in each node's config that the asset manager tried to load. */
function collectAssetProblems(scene: Scene, scenePath: string, assets: AssetManager): AssetProblem[] {
  const problems: AssetProblem[] = []
  const visit = (nodeId: string, value: unknown): void => {
    if (typeof value === 'string') {
      const message = assets.getError(value)
      if (message) problems.push({ scenePath, nodeId, url: value, message })
    } else if (Array.isArray(value)) {
      for (const item of value) visit(nodeId, item)
    } else if (value && typeof value === 'object') {
      for (const item of Object.values(value)) visit(nodeId, item)
    }
  }
  for (const node of scene.graph.nodes) visit(node.id, node.config)
  return problems
}

/** Loads a scene or demo through the bridge and builds a ready-to-render player. */
export async function loadDocument(bridge: Bridge, filePath: string, options: LoadOptions = {}): Promise<StudioDocument> {
  const file = await bridge.read(filePath)
  const kind = documentKind(file.filePath)
  if (kind === 'scene') {
    const scene = parseSceneJson(file.text)
    const runtime = await createSceneRuntime(scene, {
      sinkId: 'browser',
      buildRegistry: buildBuiltinRegistry,
      assetManager: assetOptions(bridge, file.filePath, options),
    })
    return {
      kind,
      filePath: file.filePath,
      text: file.text,
      mtimeMs: file.mtimeMs,
      scene,
      demo: null,
      player: createScenePlayer(scene, file.filePath, runtime),
      assetProblems: collectAssetProblems(scene, file.filePath, runtime.assets),
    }
  }
  const demo = parseDemoJson(file.text)
  const runtimeDocument = await createDemoRuntimeDocument(demo, {
    sinkId: 'browser',
    buildRegistry: buildBuiltinRegistry,
    assetManager: assetOptions(bridge, file.filePath, options),
    sectionAssetManager: scenePath => assetOptions(bridge, scenePath, options),
    async loadSection(rawScenePath) {
      const scenePath = resolvePath(file.filePath, rawScenePath)
      const sceneFile = await bridge.read(scenePath)
      return { scene: parseSceneJson(sceneFile.text), scenePath: sceneFile.filePath }
    },
  })
  return {
    kind,
    filePath: file.filePath,
    text: file.text,
    mtimeMs: file.mtimeMs,
    scene: null,
    demo,
    player: createDemoPlayer(runtimeDocument),
    assetProblems: runtimeDocument.sections.flatMap(section =>
      collectAssetProblems(section.runtime.scene, section.scenePath, section.runtime.assets)),
  }
}
