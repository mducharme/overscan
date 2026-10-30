import type { AudioClip, BufferPool, Demo, Modifier, NodeContext, Scene } from '@overscan/types'
import {
  createDemoRuntimeDocument,
  createSceneRuntime,
  parseDemoJson,
  parseSceneJson,
  renderDemoRuntimeFrame,
  renderSceneRuntimeFrame,
  type SceneRuntime as CoreSceneRuntime,
} from '@overscan/core/browser'
import { buildBuiltinRegistry } from '@overscan/nodes/browser'
import {
  findActiveDemoSectionIndex,
  type DemoRuntimeSection,
} from '@overscan/sequencer'

export type StudioFileType = 'scene' | 'demo'

export interface BridgeFile {
  filePath: string
  text: string
  mtimeMs: number
}

export interface FileAdapter {
  read(filePath?: string): Promise<BridgeFile>
  save(filePath: string, text: string): Promise<number>
}

export interface SceneRuntime extends CoreSceneRuntime {
  scenePath: string
}

export interface LoadedStudioDocument {
  filePath: string
  fileType: StudioFileType
  text: string
  mtimeMs: number
  scene: Scene | null
  demo: Demo | null
  sections: DemoRuntimeSection<SceneRuntime>[]
  demoModifiers: Modifier[]
  fps: number
  duration: number
  resolution: { width: number; height: number }
}

export interface DocumentAudioLayer {
  id: string
  kind: 'demo' | 'scene'
  sourcePath: string
  sourceUrl: string
  time: number
  loop: boolean
  volume: number
  start: number
  end: number
}

export interface DocumentAudioSpan {
  id: string
  kind: 'demo' | 'scene'
  label: string
  sourcePath: string
  sourceUrl: string
  start: number
  end: number
  volume: number
}

const ABSOLUTE_PATH_RE = /^(?:[a-zA-Z]:[\\/]|\\\\|\/)/

function normalizeAudioClip(audio: Scene['audio']  ): AudioClip | null {
  if (!audio) return null
  if (typeof audio === 'string') return { src: audio, volume: 1 }
  return {
    ...audio,
    volume: audio.volume ?? 1,
  }
}

function getInjectedValue(key: '__OVERSCAN_FILE__' | '__OVERSCAN_FILE_TYPE__'): string | undefined {
  const globals = globalThis as Record<string, unknown>
  const value = globals[key]
  return typeof value === 'string' ? value : undefined
}

export function detectInitialFile(): { filePath: string; fileType: StudioFileType } {
  const params = new URLSearchParams(window.location.search)
  const rawPath = params.get('file') ?? getInjectedValue('__OVERSCAN_FILE__') ?? ''
  const rawType = params.get('type') ?? getInjectedValue('__OVERSCAN_FILE_TYPE__')
  return {
    filePath: rawPath,
    fileType: rawType === 'demo' || rawPath.endsWith('.demo.json') ? 'demo' : 'scene',
  }
}

function toFileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  if (/^[a-zA-Z]:\//.test(normalized)) return `file:///${encodeURI(normalized)}`
  if (normalized.startsWith('//')) return `file:${encodeURI(normalized)}`
  return `file://${encodeURI(normalized)}`
}

function fromFileUrl(urlString: string): string {
  const url = new URL(urlString)
  let pathname = decodeURIComponent(url.pathname)
  if (/^\/[a-zA-Z]:\//.test(pathname)) pathname = pathname.slice(1)
  return pathname.replace(/\//g, '\\')
}

export function resolveFilePath(baseFilePath: string, target: string): string {
  if (/^[a-z]+:\/\//i.test(target) || target.startsWith('overscan://')) return target
  if (ABSOLUTE_PATH_RE.test(target)) return target
  return fromFileUrl(new URL(target.replace(/\\/g, '/'), toFileUrl(baseFilePath)).toString())
}

export function createBridgeAssetUrl(filePath: string): string {
  return `/__overscan__/media?path=${encodeURIComponent(filePath)}`
}

async function readBridgeFile(filePath?: string): Promise<BridgeFile> {
  const url = filePath
    ? `/__overscan__/read?path=${encodeURIComponent(filePath)}`
    : '/__overscan__/file'
  const response = await fetch(url)
  const payload = await response.json() as BridgeFile & { error?: string }
  if (!response.ok || payload.error) {
    throw new Error(payload.error ?? `Failed to load ${filePath ?? 'document'}`)
  }
  return payload
}

const bridgeFileAdapter: FileAdapter = {
  read: readBridgeFile,
  save: saveBridgeFile,
}

async function loadTextResource(resourcePath: string): Promise<string> {
  if (/^[a-z]+:\/\//i.test(resourcePath)) {
    const response = await fetch(resourcePath)
    if (!response.ok) {
      throw new Error(`Failed to fetch asset '${resourcePath}': ${response.status} ${response.statusText}`)
    }
    return response.text()
  }
  return (await readBridgeFile(resourcePath)).text
}

export async function saveBridgeFile(filePath: string, text: string): Promise<number> {
  const response = await fetch('/__overscan__/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath, text }),
  })
  const payload = await response.json() as { mtimeMs?: number; error?: string }
  if (!response.ok || payload.error) {
    throw new Error(payload.error ?? `Failed to save ${filePath}`)
  }
  return payload.mtimeMs ?? Date.now()
}

function serializeDocument(fileType: StudioFileType, scene: Scene | null, demo: Demo | null): string {
  const value = fileType === 'demo' ? demo : scene
  if (!value) throw new Error('No document loaded')
  return `${JSON.stringify(value, null, 2)}\n`
}

async function makeSceneRuntime(scene: Scene, scenePath: string): Promise<SceneRuntime> {
  const runtime = await createSceneRuntime(scene, {
    sinkId: 'browser',
    buildRegistry: buildBuiltinRegistry,
    assetManager: {
      resolveAssetUrl(url) {
        if (/^[a-z]+:\/\//i.test(url) || url.startsWith('overscan://')) return url
        return resolveFilePath(scenePath, url)
      },
      loadText(assetPath) {
        return loadTextResource(assetPath)
      },
    },
  })
  return { ...runtime, scenePath }
}

export async function loadStudioDocument(filePath: string, fileType: StudioFileType): Promise<LoadedStudioDocument> {
  const file = await bridgeFileAdapter.read(filePath)
  if (fileType === 'demo') return buildDemoDocument(file.filePath, parseDemoJson(file.text), file.text, file.mtimeMs)

  const scene = parseSceneJson(file.text)
  return buildSceneDocument(file.filePath, scene, file.text, file.mtimeMs)
}

export async function buildSceneDocument(
  filePath: string,
  scene: Scene,
  text?: string,
  mtimeMs = Date.now(),
): Promise<LoadedStudioDocument> {
  const runtime = await makeSceneRuntime(scene, filePath)
  return {
    filePath,
    fileType: 'scene',
    text: text ?? serializeDocument('scene', scene, null),
    mtimeMs,
    scene,
    demo: null,
    sections: [{
      id: scene.id,
      start: 0,
      end: scene.duration,
      scenePath: filePath,
      runtime,
      transitionType: 'cut',
      transitionDuration: 0,
      transitionEasing: 'smooth',
      transitionFlashColor: [255, 255, 255],
    }],
    demoModifiers: [],
    fps: scene.fps,
    duration: scene.duration,
    resolution: scene.resolution,
  }
}

export async function buildDemoDocument(
  filePath: string,
  demo: Demo,
  text?: string,
  mtimeMs = Date.now(),
): Promise<LoadedStudioDocument> {
  const runtimeDocument = await createDemoRuntimeDocument(demo, {
    sinkId: 'browser',
    buildRegistry: buildBuiltinRegistry,
    assetManager: {
      resolveAssetUrl(url) {
        if (/^[a-z]+:\/\//i.test(url) || url.startsWith('overscan://')) return url
        return resolveFilePath(filePath, url)
      },
      loadText(assetPath) {
        return loadTextResource(assetPath)
      },
    },
    // Each section's relative assets (shaders, textures) resolve against its own scene file.
    sectionAssetManager: scenePath => ({
      resolveAssetUrl(url) {
        if (/^[a-z]+:\/\//i.test(url) || url.startsWith('overscan://')) return url
        return resolveFilePath(scenePath, url)
      },
      loadText(assetPath) {
        return loadTextResource(assetPath)
      },
    }),
    async loadSection(sectionPath) {
      const scenePath = resolveFilePath(filePath, sectionPath)
      const sceneFile = await bridgeFileAdapter.read(scenePath)
      const scene = parseSceneJson(sceneFile.text)
      return { scene, scenePath }
    },
  })
  return {
    filePath,
    fileType: 'demo',
    text: text ?? serializeDocument('demo', null, demo),
    mtimeMs,
    scene: null,
    demo,
    sections: runtimeDocument.sections.map(section => ({
      ...section,
      runtime: {
        ...section.runtime,
        scenePath: section.scenePath,
      },
    })),
    demoModifiers: runtimeDocument.demoModifiers,
    fps: runtimeDocument.fps,
    duration: runtimeDocument.duration,
    resolution: runtimeDocument.resolution,
  }
}

export function getActiveSection(
  document: LoadedStudioDocument,
  currentTime: number,
  activeSectionId: string | null,
): DemoRuntimeSection<SceneRuntime> | null {
  if (document.sections.length === 0) return null
  if (activeSectionId) {
    const byId = document.sections.find(section => section.id === activeSectionId)
    if (byId) return byId
  }
  const index = findActiveDemoSectionIndex(document.sections, currentTime)
  return document.sections[index] ?? document.sections[0] ?? null
}

export function getDocumentAudioState(
  document: LoadedStudioDocument,
  currentTime: number,
  activeSectionId: string | null,
): DocumentAudioLayer[] {
  if (document.fileType === 'scene') {
    const sceneAudio = normalizeAudioClip(document.scene?.audio)
    if (!sceneAudio) return []
    const sourcePath = resolveFilePath(document.filePath, sceneAudio.src)
    return [{
      id: `${document.scene?.id ?? 'scene'}:audio`,
      kind: 'scene',
      sourcePath,
      sourceUrl: createBridgeAssetUrl(sourcePath),
      time: currentTime,
      loop: false,
      volume: sceneAudio.volume ?? 1,
      start: 0,
      end: document.duration,
    }]
  }

  const layers: DocumentAudioLayer[] = []
  const demoAudio = normalizeAudioClip(document.demo?.audio)
  if (demoAudio) {
    const sourcePath = resolveFilePath(document.filePath, demoAudio.src)
    layers.push({
      id: `${document.demo?.id ?? 'demo'}:audio`,
      kind: 'demo',
      sourcePath,
      sourceUrl: createBridgeAssetUrl(sourcePath),
      time: currentTime,
      loop: document.demo?.loop ?? false,
      volume: demoAudio.volume ?? 1,
      start: 0,
      end: document.duration,
    })
  }
  const activeSection = getActiveSection(document, currentTime, activeSectionId)
  const sceneAudio = normalizeAudioClip(activeSection?.runtime.scene.audio)
  if (activeSection && sceneAudio) {
    const sourcePath = resolveFilePath(activeSection.scenePath, sceneAudio.src)
    layers.push({
      id: `${activeSection.id}:audio`,
      kind: 'scene',
      sourcePath,
      sourceUrl: createBridgeAssetUrl(sourcePath),
      time: Math.max(0, currentTime - activeSection.start),
      loop: false,
      volume: sceneAudio.volume ?? 1,
      start: activeSection.start,
      end: activeSection.end,
    })
  }
  return layers
}

export function getDocumentAudioTimeline(document: LoadedStudioDocument): DocumentAudioSpan[] {
  if (document.fileType === 'scene') {
    const sceneAudio = normalizeAudioClip(document.scene?.audio)
    if (!sceneAudio) return []
    return [{
      id: `${document.scene?.id ?? 'scene'}:audio`,
      kind: 'scene',
      label: document.scene?.title ?? 'Scene audio',
      sourcePath: resolveFilePath(document.filePath, sceneAudio.src),
      sourceUrl: createBridgeAssetUrl(resolveFilePath(document.filePath, sceneAudio.src)),
      start: 0,
      end: document.duration,
      volume: sceneAudio.volume ?? 1,
    }]
  }

  const spans: DocumentAudioSpan[] = []
  const demoAudioClip = normalizeAudioClip(document.demo?.audio)
  if (demoAudioClip) {
    spans.push({
      id: `${document.demo?.id ?? 'demo'}:audio`,
      kind: 'demo',
      label: 'Demo soundtrack',
      sourcePath: resolveFilePath(document.filePath, demoAudioClip.src),
      sourceUrl: createBridgeAssetUrl(resolveFilePath(document.filePath, demoAudioClip.src)),
      start: 0,
      end: document.duration,
      volume: demoAudioClip.volume ?? 1,
    })
  }
  for (const section of document.sections) {
    const sectionAudio = normalizeAudioClip(section.runtime.scene.audio)
    if (!sectionAudio) continue
    spans.push({
      id: `${section.id}:audio`,
      kind: 'scene',
      label: `${section.id} overlay`,
      sourcePath: resolveFilePath(section.scenePath, sectionAudio.src),
      sourceUrl: createBridgeAssetUrl(resolveFilePath(section.scenePath, sectionAudio.src)),
      start: section.start,
      end: section.end,
      volume: sectionAudio.volume ?? 1,
    })
  }
  return spans
}

export function renderDocumentFrame(
  document: LoadedStudioDocument,
  ctx: NodeContext,
  pool: BufferPool,
  currentTime: number,
  frame: number,
  dt: number,
) {
  if (document.fileType === 'scene') {
    const runtime = document.sections[0]?.runtime
    if (!runtime) return null
    return renderSceneRuntimeFrame(runtime, {
      pool,
      ctx,
      t: currentTime,
      frame,
      dt,
      options: { strictErrors: false },
    })
  }

  return renderDemoRuntimeFrame({
    sections: document.sections,
    demoModifiers: document.demoModifiers,
  }, {
    pool,
    ctx,
    t: currentTime,
    frame,
    dt,
    options: { strictErrors: false },
  })
}

export function cloneScene(scene: Scene): Scene {
  return parseSceneJson(JSON.stringify(scene))
}

export function updateSceneText(scene: Scene): string {
  return serializeDocument('scene', scene, null)
}

export function updateDemoText(demo: Demo): string {
  return serializeDocument('demo', null, demo)
}

export function getFileAdapter(): FileAdapter {
  return bridgeFileAdapter
}
