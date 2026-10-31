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
  /**
   * Every file the document is built from (the demo file and its scenes, or the scene file), keyed by
   * path: what is on disk and what is edited.
   */
  files: Record<string, SourceFile>
}

export interface SourceFile {
  path: string
  /** Current (possibly edited) text. */
  text: string
  /** Text as last loaded or saved; the file is dirty when `text` differs. */
  savedText: string
  /** Modification time of the version on disk we last saw, to detect outside changes before saving. */
  mtimeMs: number
}

export interface LoadOptions {
  /** Decodes image bytes (browser: createImageBitmap + canvas). Without it, image assets report an error. */
  decodeImage?: (bytes: Uint8Array) => Promise<LoadedImageAsset | undefined>
  /**
   * Files to build from instead of what is on disk (edited text, keeping what was saved), so an edit
   * that changes the document's shape can rebuild it without saving first.
   */
  files?: Readonly<Record<string, SourceFile>>
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
export async function loadDocument(diskBridge: Bridge, filePath: string, options: LoadOptions = {}): Promise<StudioDocument> {
  const files: Record<string, SourceFile> = {}
  const overlay = options.files ?? {}
  const bridge: Bridge = {
    ...diskBridge,
    async read(path) {
      const edited = overlay[path]
      const read = edited ? { filePath: edited.path, text: edited.text, mtimeMs: edited.mtimeMs } : await diskBridge.read(path)
      files[read.filePath] = { path: read.filePath, text: read.text, savedText: edited?.savedText ?? read.text, mtimeMs: read.mtimeMs }
      return read
    },
  }
  const file = await bridge.read(filePath)
  const kind = documentKind(file.filePath)
  if (kind === 'scene') {
    const scene = parseSceneJson(file.text)
    const runtime = await createSceneRuntime(scene, {
      sinkId: 'browser',
      buildRegistry: buildBuiltinRegistry,
      assetManager: assetOptions(diskBridge, file.filePath, options),
    })
    return {
      kind,
      filePath: file.filePath,
      text: file.text,
      mtimeMs: file.mtimeMs,
      scene,
      demo: null,
      player: createScenePlayer(scene, file.filePath, runtime, buildBuiltinRegistry),
      assetProblems: collectAssetProblems(scene, file.filePath, runtime.assets),
      files,
    }
  }
  const demo = parseDemoJson(file.text)
  const runtimeDocument = await createDemoRuntimeDocument(demo, {
    sinkId: 'browser',
    buildRegistry: buildBuiltinRegistry,
    assetManager: assetOptions(diskBridge, file.filePath, options),
    sectionAssetManager: scenePath => assetOptions(diskBridge, scenePath, options),
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
    player: createDemoPlayer(runtimeDocument, buildBuiltinRegistry),
    files,
    assetProblems: runtimeDocument.sections.flatMap(section =>
      collectAssetProblems(section.runtime.scene, section.scenePath, section.runtime.assets)),
  }
}
