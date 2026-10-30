import { useEffect, useMemo, useRef, useState } from 'react'
import type { AudioClip, BufferPool, Demo, DemoModifier, DemoSection, FrameBuffer, NodeContext, Scene, SceneEdge } from '@overscan/types'
import {
  BufferPoolBrowser,
  createBrowserTimeSource,
  parseDemoJson,
  parseSceneJson,
  PlaybackClock,
  WebglBufferPool,
} from '@overscan/core/browser'
import { buildBuiltinRegistry } from '@overscan/nodes/browser'
import { Canvas2dDisplaySink, WebglDisplaySink } from '@overscan/sink-browser'
import type { Connection } from 'reactflow'
import {
  buildSceneDocument,
  buildDemoDocument,
  cloneScene,
  detectInitialFile,
  getFileAdapter,
  getActiveSection,
  getDocumentAudioTimeline,
  getDocumentAudioState,
  loadStudioDocument,
  renderDocumentFrame,
  type LoadedStudioDocument,
} from '../lib/runtime'
import {
  formatTime,
  frameToAnsiHtml,
  frameToAsciiHtml,
  parseTimecode,
  resizeRgbaNearest,
  terminalGridForViewport,
  type PreviewState,
} from '../lib/preview'
import { createDefaultNode, getNodeCatalogItem, getPortKindForNode, type NodeCatalogItem } from '../graph/node-catalog'
import { computeAutoLayoutPositions, createFlowEdgeId, edgeKind } from '../graph/scene-flow'
import { useStudioStore } from '../store/studio'

const EMPTY_PREVIEW: PreviewState = {
  asciiHtml: '',
  ansiHtml: '',
  fps: 0,
  lastError: null,
}

interface SceneHistoryEntry {
  undo: string[]
  redo: string[]
}

const PLAYBACK_RATES = [0.25, 0.5, 1, 2] as const
const UI_UPDATE_INTERVAL_MS = 100

function normalizeAudioClip(audio: Scene['audio']  ): AudioClip | null {
  if (!audio) return null
  if (typeof audio === 'string') return { src: audio, volume: 1 }
  return {
    ...audio,
    volume: audio.volume ?? 1,
  }
}

async function setAudioElementTime(audio: HTMLAudioElement, time: number): Promise<void> {
  const targetTime = Math.max(0, time)
  if (audio.readyState < 1) {
    await new Promise<void>(resolve => {
      audio.addEventListener('loadedmetadata', () => { resolve(); }, { once: true })
    })
  }
  if (Math.abs(audio.currentTime - targetTime) <= 0.05) return
  await new Promise<void>(resolve => {
    const finish = () => { resolve(); }
    audio.addEventListener('seeked', finish, { once: true })
    try {
      audio.currentTime = targetTime
    } catch {
      resolve()
    }
    window.setTimeout(resolve, 150)
  })
}

function syncPlayingAudioElement(audio: HTMLAudioElement, time: number): void {
  const targetTime = Math.max(0, time)
  if (audio.readyState < 1 || audio.seeking) return
  if (Math.abs(audio.currentTime - targetTime) <= 0.2) return
  try {
    audio.currentTime = targetTime
  } catch {}
}

function nodeLayoutStorageKey(filePath: string): string {
  return `overscan:studio:layout:${filePath}`
}

function panelLayoutStorageKey(filePath: string): string {
  return `overscan:studio:panels:${filePath}`
}

function serializeScene(scene: Scene): string {
  return `${JSON.stringify(scene, null, 2)}\n`
}

function createsCycle(scene: Scene, sourceNodeId: string, targetNodeId: string): boolean {
  if (sourceNodeId === targetNodeId) return true
  const outgoing = new Map<string, string[]>()
  for (const edge of scene.graph.edges) {
    const list = outgoing.get(edge.from.node) ?? []
    list.push(edge.to.node)
    outgoing.set(edge.from.node, list)
  }
  const stack = [targetNodeId]
  const seen = new Set<string>()
  while (stack.length > 0) {
    const current = stack.pop()!
    if (current === sourceNodeId) return true
    if (seen.has(current)) continue
    seen.add(current)
    for (const next of outgoing.get(current) ?? []) stack.push(next)
  }
  return false
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function createDefaultDemoSection(existing: DemoSection[], scenePath: string): DemoSection {
  let index = existing.length + 1
  let candidate = `section${index}`
  while (existing.some(section => section.id === candidate)) {
    index += 1
    candidate = `section${index}`
  }
  return {
    id: candidate,
    scene: scenePath,
  }
}

export function useStudioApp() {
  const glCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const canvas2dRef = useRef<HTMLCanvasElement | null>(null)
  const previewRef = useRef<PreviewState>(EMPTY_PREVIEW)
  const clockRef = useRef(new PlaybackClock(createBrowserTimeSource()))
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map())
  const audioUnlockedRef = useRef(false)
  const audioManualSeekUntilRef = useRef(0)

  const [documentState, setDocumentState] = useState<LoadedStudioDocument | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [previewState, setPreviewState] = useState<PreviewState>(EMPTY_PREVIEW)
  const [mtimeMs, setMtimeMs] = useState(0)
  const [editedSceneTexts, setEditedSceneTexts] = useState<Record<string, string>>({})
  const [graphError, setGraphError] = useState<string | null>(null)
  const [sceneHistory, setSceneHistory] = useState<Record<string, SceneHistoryEntry>>({})
  const [nodeThumbnails] = useState<Record<string, never>>({})
  const [externalReloadAvailable, setExternalReloadAvailable] = useState(false)
  const [audioError, setAudioError] = useState<string | null>(null)
  const [shaderDraft, setShaderDraft] = useState('')
  const [edgeInspectorData, setEdgeInspectorData] = useState<{
    kind: 'buffer' | 'signal' | 'mask'
    currentValue?: number
    min?: number
    max?: number
    mean?: number
    thumbnailSrc?: string
    width?: number
    height?: number
  } | null>(null)

  const store = useStudioStore()
  const {
    filePath,
    fileType,
    unsaved,
    selectedNodeId,
    selectedEdgeId,
    activeSectionId,
    playing,
    playbackRate,
    loopRange,
    renderer,
    previewWidth,
    previewHeight,
    nodePositions,
    setDocument,
    setNodePosition,
    setNodePositions,
    setUnsaved,
    setPlaying,
    setCurrentTime,
    setRenderer,
    setPlaybackRate,
    setLoopRange,
  } = store

  useEffect(() => {
    const initial = detectInitialFile()
    setDocument(initial.filePath, initial.fileType)
    if (!initial.filePath) {
      setError('No file selected. Launch via `overscan dev <scene.json|demo.json>` or open the studio with a `?file=...` query.')
      setLoading(false)
    }
  }, [setDocument])

  useEffect(() => {
    if (!filePath) {
      setDocumentState(null)
      setLoading(false)
      return
    }
    setEditedSceneTexts({})
    setSceneHistory({})
    setEdgeInspectorData(null)
    setExternalReloadAvailable(false)
    try {
      const raw = window.localStorage.getItem(nodeLayoutStorageKey(filePath))
      setNodePositions(raw ? JSON.parse(raw) as typeof nodePositions : {})
    } catch {
      setNodePositions({})
    }
    try {
      const raw = window.localStorage.getItem(panelLayoutStorageKey(filePath))
      if (raw) {
        store.setPanelLayout(JSON.parse(raw) as typeof store.panelLayout)
      }
    } catch {
      // Ignore invalid persisted layout state.
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    void loadStudioDocument(filePath, fileType)
      .then(loaded => {
        if (cancelled) return
        setDocumentState(loaded)
        setMtimeMs(loaded.mtimeMs)
        clockRef.current.seek(0)
        clockRef.current.setRate(playbackRate)
        setCurrentTime(0)
      })
      .catch(loadError => {
        if (cancelled) return
        setError(loadError instanceof Error ? loadError.message : String(loadError))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [filePath, fileType, playbackRate, setCurrentTime, setNodePositions])

  useEffect(() => {
    if (!filePath) return
    window.localStorage.setItem(nodeLayoutStorageKey(filePath), JSON.stringify(nodePositions))
  }, [filePath, nodePositions])

  useEffect(() => {
    if (!filePath) return
    window.localStorage.setItem(panelLayoutStorageKey(filePath), JSON.stringify(store.panelLayout))
  }, [filePath, store.panelLayout])

  const activeSection = useMemo(
    () => documentState ? getActiveSection(documentState, store.currentTime, activeSectionId) : null,
    [activeSectionId, documentState, store.currentTime],
  )
  const activeScene = activeSection?.runtime.scene ?? documentState?.scene ?? null
  const selectedNode = activeScene?.graph.nodes.find(node => node.id === selectedNodeId) ?? null
  const selectedEdge = activeScene?.graph.edges.find((edge, index) =>
    createFlowEdgeId(edge.from.node, edge.from.output, edge.to.node, edge.to.input, index) === selectedEdgeId,
  ) ?? null
  const rendererBadges = useMemo(() => {
    if (!activeScene) return {}
    const registry = buildBuiltinRegistry(activeScene.graph.nodes)
    return Object.fromEntries(activeScene.graph.nodes.map(node => {
      const runtimeNode = registry.get(node.id)
      if (!runtimeNode) return [node.id, 'CPU']
      if (runtimeNode.type === 'signal') return [node.id, 'SIG']
      if (runtimeNode.type === 'generator') {
        return [node.id, runtimeNode.renderers.includes('gpu') ? 'CPU/GPU' : 'CPU']
      }
      return [node.id, typeof runtimeNode.glsl === 'string' ? 'CPU/GPU' : 'CPU']
    }))
  }, [activeScene])
  const signalHistoryRef = useRef<Record<string, number[]>>({})
  const selectedEdgeRef = useRef(selectedEdge)
  const activeSceneRef = useRef(activeScene)
  useEffect(() => {
    selectedEdgeRef.current = selectedEdge
    activeSceneRef.current = activeScene
  }, [selectedEdge, activeScene])

  useEffect(() => {
    if (!selectedEdge) {
      setEdgeInspectorData(null)
      return
    }
    const kind = edgeKind(selectedEdge, activeScene ?? undefined)
    if (kind !== 'signal') {
      setEdgeInspectorData({
        kind,
      })
      return
    }
    const samples = signalHistoryRef.current[`${selectedEdge.from.node}.${selectedEdge.from.output}`] ?? []
    setEdgeInspectorData({
      kind,
      currentValue: samples[samples.length - 1] ?? 0,
      min: samples.length > 0 ? Math.min(...samples) : 0,
      max: samples.length > 0 ? Math.max(...samples) : 0,
      mean: samples.length > 0 ? samples.reduce((sum, sample) => sum + sample, 0) / samples.length : 0,
    })
  }, [activeScene, selectedEdge])

  useEffect(() => {
    if (playing) clockRef.current.play()
    else clockRef.current.pause()
  }, [playing])

  useEffect(() => {
    const unlockAudio = () => {
      audioUnlockedRef.current = true
    }
    window.addEventListener('pointerdown', unlockAudio, { passive: true })
    window.addEventListener('keydown', unlockAudio)
    return () => {
      window.removeEventListener('pointerdown', unlockAudio)
      window.removeEventListener('keydown', unlockAudio)
    }
  }, [])

  useEffect(() => {
    clockRef.current.setRate(playbackRate)
  }, [playbackRate])

  useEffect(() => {
    const layers = documentState ? getDocumentAudioState(documentState, store.currentTime, activeSectionId) : []
    const activeSources = new Set(layers.map(layer => layer.sourcePath))

    if (layers.length === 0) {
      setAudioError(null)
    }

    for (const [sourcePath, audio] of audioRefs.current.entries()) {
      if (activeSources.has(sourcePath)) continue
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      audioRefs.current.delete(sourcePath)
    }

    let cancelled = false
    const inManualSeekGracePeriod = performance.now() < audioManualSeekUntilRef.current
    for (const layer of layers) {
      const audio = audioRefs.current.get(layer.sourcePath) ?? new Audio()
      if (!audioRefs.current.has(layer.sourcePath)) {
        audio.src = layer.sourceUrl
        audio.dataset.sourcePath = layer.sourcePath
        audio.preload = 'auto'
        audio.addEventListener('error', () => {
          if (cancelled) return
          const sourcePath = audio.dataset.sourcePath ?? layer.sourcePath
          const mediaErrorCode = audio.error?.code
          const details = mediaErrorCode === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
            ? 'unsupported or missing audio source'
            : mediaErrorCode === MediaError.MEDIA_ERR_NETWORK
              ? 'network error while loading audio'
              : mediaErrorCode === MediaError.MEDIA_ERR_DECODE
                ? 'audio decode error'
                : 'failed to load audio source'
          setAudioError(`Studio audio failed for '${sourcePath}': ${details}.`)
        })
        audioRefs.current.set(layer.sourcePath, audio)
      }
      if (audio.dataset.sourcePath !== layer.sourcePath) {
        audio.src = layer.sourceUrl
        audio.dataset.sourcePath = layer.sourcePath
      }
      audio.loop = layer.loop
      audio.volume = Math.max(0, Math.min(1, layer.volume))
      audio.playbackRate = playbackRate
      if (playing) {
        if (!audioUnlockedRef.current) {
          setAudioError('Audio is waiting for a user gesture. Click anywhere in Studio, then press play again.')
          continue
        }
        if (!inManualSeekGracePeriod) {
          syncPlayingAudioElement(audio, layer.time)
        }
        if (audio.paused) {
          void audio.play()
            .then(() => {
              if (!cancelled) setAudioError(null)
            })
            .catch(error => {
              if (!cancelled) {
                const sourcePath = audio.dataset.sourcePath ?? layer.sourcePath
                const message = error instanceof Error ? error.message : 'Failed to start Studio audio playback.'
                setAudioError(`Studio audio failed for '${sourcePath}': ${message}`)
              }
            })
        }
      } else {
        audio.pause()
        void setAudioElementTime(audio, layer.time)
      }
    }
    return () => {
      cancelled = true
    }
  }, [activeSectionId, documentState, playbackRate, playing, store.currentTime])

  useEffect(() => {
    if (!documentState) return
    let cancelled = false
    const cleanupCallbacks: (() => void)[] = []
    const executionMode = renderer === 'gl' ? 'gpu' : 'cpu'
    const glCanvas = glCanvasRef.current ?? document.createElement('canvas')
    const canvas2d = canvas2dRef.current ?? document.createElement('canvas')
    const glSink = new WebglDisplaySink(glCanvas)
    const canvasSink = new Canvas2dDisplaySink(canvas2d)
    const previewCanvas = typeof OffscreenCanvas === 'undefined'
      ? null
      : new OffscreenCanvas(documentState.resolution.width, documentState.resolution.height)
    const previewCtx = previewCanvas?.getContext('2d') ?? null
    void Promise.allSettled([
      glSink.init(documentState.resolution.width, documentState.resolution.height, documentState.fps),
      canvasSink.init(documentState.resolution.width, documentState.resolution.height, documentState.fps),
    ]).then(results => {
      const glResult = results[0]
      const canvasResult = results[1]
      if (canvasResult?.status === 'rejected') {
        throw canvasResult.reason
      }
      const glInitError = glResult?.status === 'rejected'
        ? (glResult.reason instanceof Error ? glResult.reason.message : String(glResult.reason))
        : null
      const outputRenderer = renderer === 'gl' && glInitError ? '2d' : renderer
      if (renderer === 'gl' && glInitError) {
        setRenderer('2d')
        previewRef.current = {
          ...previewRef.current,
          lastError: `${glInitError}. Falling back to 2D preview.`,
        }
        setPreviewState({ ...previewRef.current })
      }
      const executionGl = executionMode === 'gpu' && !glInitError ? glSink.context : null
      const pool: BufferPool = executionGl ? new WebglBufferPool(executionGl) : new BufferPoolBrowser()
      const ctx: NodeContext = {
        canvas: previewCanvas,
        ctx2d: previewCtx,
        gl: executionGl,
        pool,
        width: documentState.resolution.width,
        height: documentState.resolution.height,
      }
      for (const section of documentState.sections) {
        ctx.assets = section.runtime.assets
        section.runtime.executor.init(ctx)
      }
      for (const modifier of documentState.demoModifiers) {
        modifier.init(ctx)
      }
      cleanupCallbacks.push(() => {
        for (const section of documentState.sections) {
          section.runtime.executor.destroy()
        }
        for (const modifier of documentState.demoModifiers) {
          modifier.destroy()
        }
        glSink.destroy()
      })

      let frame = 0
      let previousTime = 0
      let lastUiUpdateAt = 0

      const updateLiveInspectorData = (signal: { sources: Record<string, number> }) => {
        for (const [key, value] of Object.entries(signal.sources)) {
          const samples = [...(signalHistoryRef.current[key] ?? []), value].slice(-120)
          signalHistoryRef.current[key] = samples
        }
        const currentSelectedEdge = selectedEdgeRef.current
        if (!currentSelectedEdge) return
        const kind = edgeKind(currentSelectedEdge, activeSceneRef.current ?? undefined)
        if (kind === 'signal') {
          const key = `${currentSelectedEdge.from.node}.${currentSelectedEdge.from.output}`
          const samples = signalHistoryRef.current[key] ?? []
          const currentValue = samples[samples.length - 1] ?? 0
          const min = samples.length > 0 ? Math.min(...samples) : 0
          const max = samples.length > 0 ? Math.max(...samples) : 0
          const mean = samples.length > 0 ? samples.reduce((sum, sample) => sum + sample, 0) / samples.length : 0
          setEdgeInspectorData({ kind, currentValue, min, max, mean })
          return
        }
        setEdgeInspectorData({
          kind,
        })
      }

      const frameStep = async () => {
        if (cancelled) return
        const nextTime = clockRef.current.currentTime()
        const dt = frame === 0 ? 0 : Math.max(0, nextTime - previousTime) || (1 / documentState.fps)
        const terminalGrid = terminalGridForViewport({ width: previewWidth, height: previewHeight })
        const rendered = renderDocumentFrame(documentState, ctx, pool, nextTime, frame, dt)
        if (rendered) {
          if (outputRenderer === 'ascii' || outputRenderer === 'ansi') {
            const terminalHeight = outputRenderer === 'ansi' ? terminalGrid.rows * 2 : terminalGrid.rows
            const terminalBuffer = {
              id: 'studio-terminal-preview',
              width: terminalGrid.columns,
              height: terminalHeight,
              data: resizeRgbaNearest(
                rendered.buffer.width,
                rendered.buffer.height,
                rendered.buffer.data,
                terminalGrid.columns,
                terminalHeight,
              ),
              clear() {},
            } satisfies FrameBuffer
            previewRef.current = outputRenderer === 'ascii'
              ? {
                  asciiHtml: frameToAsciiHtml(terminalBuffer),
                  ansiHtml: '',
                  fps: documentState.fps,
                  lastError: null,
                }
              : {
                  asciiHtml: '',
                  ansiHtml: frameToAnsiHtml(terminalBuffer),
                  fps: documentState.fps,
                  lastError: null,
                }
          } else {
            previewRef.current = {
              ...previewRef.current,
              fps: documentState.fps,
              lastError: previewRef.current.lastError,
            }
          }
          if (outputRenderer === 'gl') await glSink.write(rendered.buffer, frame, rendered.signal)
          if (outputRenderer === '2d') await canvasSink.write(rendered.buffer, frame, rendered.signal)
          updateLiveInspectorData(rendered.signal)
          const now = performance.now()
          if (!playing || now - lastUiUpdateAt >= UI_UPDATE_INTERVAL_MS) {
            lastUiUpdateAt = now
            setCurrentTime(nextTime)
            setPreviewState({ ...previewRef.current })
          }
          pool.release(rendered.buffer)
        }
        previousTime = nextTime
        frame += 1
        if (loopRange && nextTime >= loopRange.end) {
          clockRef.current.seek(loopRange.start)
          setCurrentTime(loopRange.start)
        } else if (documentState.fileType === 'scene' && !loopRange && nextTime >= documentState.duration) {
          const endTime = documentState.duration
          clockRef.current.pause()
          clockRef.current.seek(endTime)
          setPlaying(false)
          setCurrentTime(endTime)
        } else if (documentState.fileType === 'demo' && !loopRange && nextTime >= documentState.duration) {
          const endTime = documentState.duration
          clockRef.current.pause()
          clockRef.current.seek(endTime)
          setPlaying(false)
          setCurrentTime(endTime)
          audioManualSeekUntilRef.current = performance.now() + 600
          for (const audio of audioRefs.current.values()) {
            audio.pause()
          }
        }
        requestAnimationFrame(() => {
          void frameStep()
        })
      }
      void frameStep()
    }).catch(renderError => {
      previewRef.current = {
        ...previewRef.current,
        lastError: renderError instanceof Error ? renderError.message : String(renderError),
      }
      setPreviewState({ ...previewRef.current })
    })

    return () => {
      cancelled = true
      for (const callback of cleanupCallbacks) callback()
    }
  }, [documentState, loopRange, playing, previewHeight, previewWidth, renderer, setCurrentTime, setPlaying])

  useEffect(() => {
    if (!filePath || !documentState) return
    const id = window.setInterval(() => {
      void fetch(`/__overscan__/stat?path=${encodeURIComponent(filePath)}`)
        .then(response => response.json())
        .then((payload: { mtimeMs?: number }) => {
          if (!unsaved && typeof payload.mtimeMs === 'number' && payload.mtimeMs > mtimeMs + 1) {
            setExternalReloadAvailable(true)
          }
        })
        .catch(() => {})
    }, 4000)
    return () => {
      window.clearInterval(id)
    }
  }, [documentState, filePath, fileType, mtimeMs, unsaved])

  function currentScenePath(): string | null {
    if (!documentState) return null
    return documentState.fileType === 'scene' ? documentState.filePath : activeSection?.scenePath ?? null
  }

  function currentSceneText(): string | null {
    if (!activeScene || !documentState) return null
    const path = currentScenePath()
    if (!path) return null
    if (documentState.fileType === 'scene') return documentState.text
    return editedSceneTexts[path] ?? serializeScene(activeScene)
  }

  function currentDemoText(): string | null {
    if (!documentState || documentState.fileType !== 'demo' || !documentState.demo) return null
    return documentState.text
  }

  function recordSceneHistory(path: string, text: string): void {
    setSceneHistory(current => {
      const entry = current[path] ?? { undo: [], redo: [] }
      if (entry.undo[entry.undo.length - 1] === text) return current
      return {
        ...current,
        [path]: {
          undo: [...entry.undo, text].slice(-50),
          redo: [],
        },
      }
    })
  }

  function applySceneText(path: string, text: string, recordHistory = false): void {
    if (!documentState) return
    const scene = parseSceneJson(text)
    if (recordHistory) {
      const previousText = currentSceneText()
      if (previousText) recordSceneHistory(path, previousText)
    }
    if (documentState.fileType === 'scene' && path === documentState.filePath) {
      void buildSceneDocument(documentState.filePath, scene, text, documentState.mtimeMs)
        .then(next => { setDocumentState(next); })
        .catch(nextError => { setError(nextError instanceof Error ? nextError.message : String(nextError)); })
      setUnsaved(true)
      return
    }
    if (activeSection && path === activeSection.scenePath) {
      void buildSceneDocument(path, scene, text)
        .then(nextSectionDoc => {
          setDocumentState({
            ...documentState,
            sections: documentState.sections.map(section =>
              section.id === activeSection.id
                ? {
                    ...section,
                    runtime: nextSectionDoc.sections[0].runtime,
                    end: section.start + scene.duration,
                  }
                : section,
            ),
          })
          setEditedSceneTexts(current => ({
            ...current,
            [path]: text,
          }))
        })
        .catch(nextError => { setError(nextError instanceof Error ? nextError.message : String(nextError)); })
      setUnsaved(true)
    }
  }

  function updateDemoDocument(nextDemo: Demo): void {
    if (!documentState || documentState.fileType !== 'demo') return
    const text = `${JSON.stringify(nextDemo, null, 2)}\n`
    void buildDemoDocument(documentState.filePath, nextDemo, text, documentState.mtimeMs)
      .then(next => {
        setDocumentState(next)
        setUnsaved(true)
      })
      .catch(nextError => { setError(nextError instanceof Error ? nextError.message : String(nextError)); })
  }

  function updateDemoAudio(audio: Demo['audio']): void {
    if (!documentState?.demo) return
    updateDemoDocument({
      ...documentState.demo,
      audio,
    })
  }

  function updateDemoLoop(loop: boolean): void {
    if (!documentState?.demo) return
    updateDemoDocument({
      ...documentState.demo,
      loop,
    })
  }

  function updateDemoModifier(modifierId: string, updater: (entry: DemoModifier) => DemoModifier): void {
    if (!documentState?.demo) return
    updateDemoDocument({
      ...documentState.demo,
      modifiers: (documentState.demo.modifiers ?? []).map(entry => entry.id === modifierId ? updater(entry) : entry),
    })
  }

  function addDemoModifier(impl: string): void {
    if (!documentState?.demo) return
    let index = (documentState.demo.modifiers ?? []).length + 1
    let id = `${impl.replace(/[^a-z0-9]+/gi, '') || 'modifier'}${index}`
    while ((documentState.demo.modifiers ?? []).some(entry => entry.id === id)) {
      index += 1
      id = `${impl.replace(/[^a-z0-9]+/gi, '') || 'modifier'}${index}`
    }
    updateDemoDocument({
      ...documentState.demo,
      modifiers: [...(documentState.demo.modifiers ?? []), { id, impl, enabled: true, config: {} }],
    })
  }

  function moveDemoModifier(modifierId: string, direction: -1 | 1): void {
    if (!documentState?.demo) return
    const list = [...(documentState.demo.modifiers ?? [])]
    const index = list.findIndex(entry => entry.id === modifierId)
    if (index < 0) return
    const targetIndex = clamp(index + direction, 0, list.length - 1)
    if (index === targetIndex) return
    const [entry] = list.splice(index, 1)
    list.splice(targetIndex, 0, entry)
    updateDemoDocument({
      ...documentState.demo,
      modifiers: list,
    })
  }

  function removeDemoModifier(modifierId: string): void {
    if (!documentState?.demo) return
    updateDemoDocument({
      ...documentState.demo,
      modifiers: (documentState.demo.modifiers ?? []).filter(entry => entry.id !== modifierId),
    })
  }

  async function handleSave(): Promise<void> {
    if (!documentState) return
    const fileAdapter = getFileAdapter()
    if (documentState.fileType === 'demo' && documentState.demo) {
      const demoText = currentDemoText()
      if (demoText) {
        const savedMtime = await fileAdapter.save(documentState.filePath, demoText)
        setMtimeMs(savedMtime)
      }
    }
    if (documentState.fileType === 'demo') {
      for (const [scenePath, text] of Object.entries(editedSceneTexts)) {
        await fileAdapter.save(scenePath, text)
      }
    } else {
      const savedMtime = await fileAdapter.save(documentState.filePath, documentState.text)
      setMtimeMs(savedMtime)
    }
    setUnsaved(false)
    setExternalReloadAvailable(false)
  }

  function rewind(): void {
    seekToTime(0)
  }

  function syncAudioToTime(targetTime: number): void {
    if (!documentState) return
    audioManualSeekUntilRef.current = performance.now() + 600
    const layers = getDocumentAudioState(documentState, targetTime, activeSectionId)
    const activeSources = new Set(layers.map(layer => layer.sourcePath))

    for (const [sourcePath, audio] of audioRefs.current.entries()) {
      if (activeSources.has(sourcePath)) continue
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      audioRefs.current.delete(sourcePath)
    }

    for (const layer of layers) {
      const audio = audioRefs.current.get(layer.sourcePath) ?? new Audio()
      if (!audioRefs.current.has(layer.sourcePath)) {
        audio.src = layer.sourceUrl
        audio.dataset.sourcePath = layer.sourcePath
        audio.preload = 'auto'
        audioRefs.current.set(layer.sourcePath, audio)
      }
      audio.pause()
      audio.loop = layer.loop
      audio.volume = Math.max(0, Math.min(1, layer.volume))
      audio.playbackRate = playbackRate
      if (playing && audioUnlockedRef.current) {
        void setAudioElementTime(audio, layer.time)
          .then(() => audio.play())
          .then(() => {
            setAudioError(null)
          })
          .catch(error => {
            const sourcePath = audio.dataset.sourcePath ?? layer.sourcePath
            const message = error instanceof Error ? error.message : 'Failed to resume Studio audio playback.'
            setAudioError(`Studio audio failed for '${sourcePath}': ${message}`)
          })
      } else {
        void setAudioElementTime(audio, layer.time)
      }
    }
  }

  function seekToTime(nextTime: number): void {
    if (!documentState) return
    const clamped = clamp(nextTime, 0, documentState.duration)
    clockRef.current.seek(clamped)
    setCurrentTime(clamped)
    syncAudioToTime(clamped)
  }

  function seekToTimecode(raw: string): boolean {
    const parsed = parseTimecode(raw)
    if (parsed === null || !documentState) return false
    seekToTime(parsed)
    return true
  }

  function stepFrames(direction: -1 | 1): void {
    if (!documentState) return
    const delta = direction / Math.max(1, documentState.fps)
    seekToTime(store.currentTime + delta)
  }

  function togglePlayback(): void {
    setPlaying(!useStudioStore.getState().playing)
  }

  function setPlaybackRateAndClock(nextRate: number): void {
    const supported = PLAYBACK_RATES.includes(nextRate as (typeof PLAYBACK_RATES)[number]) ? nextRate : 1
    setPlaybackRate(supported)
    clockRef.current.setRate(supported)
  }

  function toggleLooping(): void {
    if (!documentState) return
    if (loopRange) {
      setLoopRange(null)
      return
    }
    setLoopRange({
      start: 0,
      end: documentState.duration,
    })
  }

  function updateScene(scene: Scene): void {
    const path = currentScenePath()
    if (!path) return
    applySceneText(path, serializeScene(scene), true)
  }

  function updateNodeConfig(nodeId: string, key: string, value: unknown): void {
    if (!activeScene) return
    const updatedScene = cloneScene(activeScene)
    const target = updatedScene.graph.nodes.find(node => node.id === nodeId)
    if (!target) return
    target.config[key] = value
    updateScene(updatedScene)
  }

  function renameSelectedNode(nodeId: string): void {
    if (!activeScene || !selectedNodeId || !nodeId.trim()) return
    if (activeScene.graph.nodes.some(node => node.id === nodeId.trim() && node.id !== selectedNodeId)) {
      setGraphError(`Node '${nodeId.trim()}' already exists`)
      return
    }
    const updatedScene = cloneScene(activeScene)
    const target = updatedScene.graph.nodes.find(node => node.id === selectedNodeId)
    if (!target) return
    const nextId = nodeId.trim()
    target.id = nextId
    updatedScene.graph.edges = updatedScene.graph.edges.map(edge => ({
      ...edge,
      from: { ...edge.from, node: edge.from.node === selectedNodeId ? nextId : edge.from.node },
      to: { ...edge.to, node: edge.to.node === selectedNodeId ? nextId : edge.to.node },
    }))
    Object.keys(updatedScene.graph.outputs).forEach(key => {
      if (updatedScene.graph.outputs[key] === selectedNodeId) {
        updatedScene.graph.outputs[key] = nextId
      }
    })
    updateScene(updatedScene)
    store.selectNode(nextId)
  }

  function setNodeResolution(nodeId: string, resolution: { width: number; height: number } | null): void {
    if (!activeScene) return
    const updatedScene = cloneScene(activeScene)
    const target = updatedScene.graph.nodes.find(node => node.id === nodeId)
    if (!target) return
    target.resolution = resolution ?? undefined
    updateScene(updatedScene)
  }

  function setNodeTiming(nodeId: string, timing: { startTime?: number; endTime?: number }): void {
    if (!activeScene) return
    const updatedScene = cloneScene(activeScene)
    const target = updatedScene.graph.nodes.find(node => node.id === nodeId)
    if (!target) return
    target.startTime = timing.startTime
    target.endTime = timing.endTime
    updateScene(updatedScene)
  }

  function jumpToSection(sectionId: string, start: number): void {
    store.setActiveSection(sectionId)
    const section = documentState?.sections.find(entry => entry.id === sectionId)
    if (!section) {
      seekToTime(start)
      return
    }
    const transitionOffset = section.transitionDuration > 0
      ? Math.min(section.transitionDuration + (1 / Math.max(1, documentState?.fps ?? 60)), Math.max(0, section.end - section.start))
      : 0
    seekToTime(section.start + transitionOffset)
  }

  function updateNodePosition(nodeId: string, position: { x: number; y: number }): void {
    setNodePosition(nodeId, position)
  }

  function autoLayoutGraph(): void {
    if (!activeScene) return
    setNodePositions(computeAutoLayoutPositions(activeScene))
  }

  function addNode(item: NodeCatalogItem): void {
    if (!activeScene) return
    const updatedScene = cloneScene(activeScene)
    updatedScene.graph.nodes.push(createDefaultNode(item, updatedScene.graph.nodes.map(node => node.id)))
    updateScene(updatedScene)
  }

  function validateConnection(connection: Connection): string | null {
    if (!activeScene) return 'No active scene'
    const source = connection.source
    const target = connection.target
    const sourceHandle = connection.sourceHandle ?? 'color'
    const targetHandle = connection.targetHandle ?? 'color'
    if (!source || !target) return 'Missing connection endpoint'
    const candidate: SceneEdge = {
      from: { node: source, output: sourceHandle },
      to: { node: target, input: targetHandle },
    }
    const sourceNode = activeScene.graph.nodes.find(node => node.id === source)
    const targetNode = activeScene.graph.nodes.find(node => node.id === target)
    if (!sourceNode || !targetNode) return 'Unknown node in connection'
    const sourceKind = getPortKindForNode(sourceNode.impl, 'output', sourceHandle)
    const targetKind = getPortKindForNode(targetNode.impl, 'input', targetHandle)
    if (!sourceKind) return `Unknown source port '${sourceHandle}'`
    if (!targetKind) return `Unknown target port '${targetHandle}'`
    const kind = edgeKind(candidate, activeScene)
    if (activeScene.graph.edges.some(edge =>
      edge.from.node === source &&
      edge.from.output === sourceHandle &&
      edge.to.node === target &&
      edge.to.input === targetHandle,
    )) return 'This edge already exists'
    if (sourceKind === 'signal' && targetKind !== 'signal') return 'Signal outputs must connect to signal inputs'
    if (sourceKind === 'buffer' && targetKind === 'signal') return 'Buffer outputs cannot feed signal inputs'
    if (sourceKind === 'buffer' && targetKind === 'mask') return 'Only mask-compatible inputs may use mask ports'
    if (kind === 'signal' && targetKind === 'mask') return 'Signal outputs cannot feed mask inputs'
    if (createsCycle(activeScene, source, target)) return 'This connection would create a cycle'
    return null
  }

  function connectNodes(connection: Connection): void {
    if (!activeScene) return
    const validationError = validateConnection(connection)
    if (validationError) {
      setGraphError(validationError)
      return
    }
    setGraphError(null)
    const source = connection.source
    const target = connection.target
    const sourceHandle = connection.sourceHandle ?? 'color'
    const targetHandle = connection.targetHandle ?? 'color'
    if (!source || !target) return
    if (activeScene.graph.edges.some(edge =>
      edge.from.node === source &&
      edge.from.output === sourceHandle &&
      edge.to.node === target &&
      edge.to.input === targetHandle,
    )) return

    const updatedScene = cloneScene(activeScene)
    updatedScene.graph.edges.push({
      from: { node: source, output: sourceHandle },
      to: { node: target, input: targetHandle },
    })
    updateScene(updatedScene)
  }

  function removeSelectedEdge(): void {
    if (!activeScene || !selectedEdgeId) return
    const updatedScene = cloneScene(activeScene)
    updatedScene.graph.edges = updatedScene.graph.edges.filter((edge, index) =>
      createFlowEdgeId(edge.from.node, edge.from.output, edge.to.node, edge.to.input, index) !== selectedEdgeId,
    )
    updateScene(updatedScene)
    store.selectEdge(null)
  }

  function deleteSelection(): void {
    if (!activeScene) return
    if (selectedEdgeId) {
      removeSelectedEdge()
      return
    }
    if (!selectedNodeId) return
    const updatedScene = cloneScene(activeScene)
    updatedScene.graph.nodes = updatedScene.graph.nodes.filter(node => node.id !== selectedNodeId)
    updatedScene.graph.edges = updatedScene.graph.edges.filter(edge => edge.from.node !== selectedNodeId && edge.to.node !== selectedNodeId)
    Object.keys(updatedScene.graph.outputs).forEach(key => {
      if (updatedScene.graph.outputs[key] === selectedNodeId) {
        const fallback = updatedScene.graph.nodes[0]?.id
        if (fallback) updatedScene.graph.outputs[key] = fallback
        else delete updatedScene.graph.outputs[key]
      }
    })
    updateScene(updatedScene)
    store.selectNode(null)
  }

  function duplicateSelection(): void {
    if (!activeScene || !selectedNodeId) return
    const updatedScene = cloneScene(activeScene)
    const sourceNode = updatedScene.graph.nodes.find(node => node.id === selectedNodeId)
    if (!sourceNode) return
    const sourceCatalogItem = getNodeCatalogItem(sourceNode.impl)
    if (!sourceCatalogItem) return
    const duplicate = createDefaultNode(sourceCatalogItem, updatedScene.graph.nodes.map(node => node.id))
    duplicate.config = JSON.parse(JSON.stringify(sourceNode.config))
    updatedScene.graph.nodes.push(duplicate)
    updateScene(updatedScene)
    const currentPosition = nodePositions[selectedNodeId]
    if (currentPosition) {
      setNodePosition(duplicate.id, { x: currentPosition.x + 40, y: currentPosition.y + 40 })
    }
    store.selectNode(duplicate.id)
  }

  function undoGraphChange(): void {
    const path = currentScenePath()
    const currentText = currentSceneText()
    if (!path || !currentText) return
    const entry = sceneHistory[path]
    const previous = entry?.undo[entry.undo.length - 1]
    if (!previous) return
    setSceneHistory(current => ({
      ...current,
      [path]: {
        undo: current[path].undo.slice(0, -1),
        redo: [...current[path].redo, currentText].slice(-50),
      },
    }))
    applySceneText(path, previous, false)
  }

  function redoGraphChange(): void {
    const path = currentScenePath()
    const currentText = currentSceneText()
    if (!path || !currentText) return
    const entry = sceneHistory[path]
    const next = entry?.redo[entry.redo.length - 1]
    if (!next) return
    setSceneHistory(current => ({
      ...current,
      [path]: {
        undo: [...current[path].undo, currentText].slice(-50),
        redo: current[path].redo.slice(0, -1),
      },
    }))
    applySceneText(path, next, false)
  }

  function updateSceneMetadata<K extends keyof Scene>(key: K, value: Scene[K]): void {
    if (!activeScene) return
    updateScene({
      ...activeScene,
      [key]: value,
    })
  }

  function updateSelectedEdgeMeta(nextMeta: Partial<SceneEdge>): void {
    if (!activeScene || !selectedEdgeId) return
    const updatedScene = cloneScene(activeScene)
    updatedScene.graph.edges = updatedScene.graph.edges.map((edge, index) =>
      createFlowEdgeId(edge.from.node, edge.from.output, edge.to.node, edge.to.input, index) === selectedEdgeId
        ? { ...edge, ...nextMeta }
        : edge,
    )
    updateScene(updatedScene)
  }

  function updateDemoSection(sectionId: string, updater: (section: DemoSection) => DemoSection): void {
    if (!documentState?.demo) return
    const nextDemo: Demo = {
      ...documentState.demo,
      sections: documentState.demo.sections.map(section => section.id === sectionId ? updater(section) : section),
    }
    updateDemoDocument(nextDemo)
  }

  function moveDemoSection(sectionId: string, targetIndex: number): void {
    if (!documentState?.demo) return
    const currentIndex = documentState.demo.sections.findIndex(section => section.id === sectionId)
    if (currentIndex < 0) return
    const nextSections = [...documentState.demo.sections]
    const [section] = nextSections.splice(currentIndex, 1)
    nextSections.splice(clamp(targetIndex, 0, nextSections.length), 0, section)
    updateDemoDocument({
      ...documentState.demo,
      sections: nextSections,
    })
  }

  function addDemoSection(): void {
    if (!documentState?.demo) return
    const scenePath = documentState.demo.sections.at(-1)?.scene ?? documentState.sections.at(-1)?.scenePath ?? ''
    updateDemoDocument({
      ...documentState.demo,
      sections: [...documentState.demo.sections, createDefaultDemoSection(documentState.demo.sections, scenePath)],
    })
  }

  function removeDemoSection(sectionId: string): void {
    if (!documentState?.demo || documentState.demo.sections.length <= 1) return
    updateDemoDocument({
      ...documentState.demo,
      sections: documentState.demo.sections.filter(section => section.id !== sectionId),
    })
  }

  function duplicateDemoSection(sectionId: string): void {
    if (!documentState?.demo) return
    const source = documentState.demo.sections.find(section => section.id === sectionId)
    if (!source) return
    const duplicate = createDefaultDemoSection(documentState.demo.sections, source.scene)
    updateDemoDocument({
      ...documentState.demo,
      sections: documentState.demo.sections.flatMap(section => section.id === sectionId ? [section, { ...source, id: duplicate.id }] : [section]),
    })
  }

  function reloadExternalChanges(): void {
    if (!filePath) return
    setExternalReloadAvailable(false)
    void loadStudioDocument(filePath, fileType)
      .then(fresh => {
        setDocumentState(fresh)
        setMtimeMs(fresh.mtimeMs)
      })
      .catch(loadError => { setError(loadError instanceof Error ? loadError.message : String(loadError)); })
  }

  function openShaderEditor(): void {
    if (!selectedNode || typeof selectedNode.config.glsl !== 'string') return
    setShaderDraft(selectedNode.config.glsl)
  }

  function saveShaderDraft(): void {
    if (!selectedNode || typeof selectedNode.config.glsl !== 'string') return
    updateNodeConfig(selectedNode.id, 'glsl', shaderDraft)
  }

  const signalOptions = useMemo(() => Object.entries(signalHistoryRef.current).map(([key, samples]) => {
    const [nodeId, output] = key.split('.')
    return {
      key,
      nodeId,
      output,
      value: samples[samples.length - 1] ?? 0,
    }
  }), [previewState.fps, selectedEdgeId, selectedNodeId])

  function connectNodeParamToSignal(nodeId: string, key: string, sourceKey: string | null): void {
    if (!activeScene) return
    if (!sourceKey) {
      const currentValue = activeScene.graph.nodes.find(node => node.id === nodeId)?.config[key]
      updateNodeConfig(nodeId, key, typeof currentValue === 'number' ? currentValue : 0)
      return
    }
    const [sourceNode, output] = sourceKey.split('.')
    updateNodeConfig(nodeId, key, { node: sourceNode, output })
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !(event.target instanceof HTMLInputElement)) {
        event.preventDefault()
        togglePlayback()
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        duplicateSelection()
      }
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        undoGraphChange()
      }
      if (((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'z') || (event.ctrlKey && event.key.toLowerCase() === 'y')) {
        event.preventDefault()
        redoGraphChange()
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void handleSave()
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'ArrowLeft') {
        event.preventDefault()
        rewind()
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'ArrowRight' && documentState) {
        event.preventDefault()
        seekToTime(documentState.duration)
      }
      if (event.key === '[') {
        event.preventDefault()
        stepFrames(-1)
      }
      if (event.key === ']') {
        event.preventDefault()
        stepFrames(1)
      }
      if ((event.ctrlKey || event.metaKey) && ['1', '2', '3', '4'].includes(event.key)) {
        event.preventDefault()
        const map = { '1': 'ascii', '2': 'ansi', '3': '2d', '4': 'gl' } as const
        store.setRenderer(map[event.key as keyof typeof map])
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        store.setProfileOverlay(!useStudioStore.getState().profileOverlay)
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && !(event.target instanceof HTMLInputElement)) {
        event.preventDefault()
        deleteSelection()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown); }
  }, [documentState])

  return {
    glCanvasRef,
    canvas2dRef,
    documentState,
    loading,
    error,
    previewState,
    graphError,
    nodeThumbnails,
    rendererBadges,
    edgeInspectorData,
    activeSection,
    activeScene,
    selectedNode,
    selectedEdge,
    externalReloadAvailable,
    shaderDraft,
    setShaderDraft,
    signalOptions,
    handleSave,
    rewind,
    togglePlayback,
    seekToTime,
    seekToTimecode,
    stepFrames,
    setPlaybackRate: setPlaybackRateAndClock,
    toggleLooping,
    updateScene,
    updateSceneMetadata,
    updateNodeConfig,
    renameSelectedNode,
    setNodeResolution,
    setNodeTiming,
    updateNodePosition,
    autoLayoutGraph,
    addNode,
    connectNodes,
    connectNodeParamToSignal,
    validateConnection,
    removeSelectedEdge,
    updateSelectedEdgeMeta,
    deleteSelection,
    duplicateSelection,
    undoGraphChange,
    redoGraphChange,
    canUndo: Boolean(currentScenePath() && sceneHistory[currentScenePath()!]?.undo.length),
    canRedo: Boolean(currentScenePath() && sceneHistory[currentScenePath()!]?.redo.length),
    jumpToSection,
    updateDemoSection,
    moveDemoSection,
    addDemoSection,
    removeDemoSection,
    duplicateDemoSection,
    updateDemoAudio,
    updateDemoLoop,
    updateDemoModifier,
    addDemoModifier,
    moveDemoModifier,
    removeDemoModifier,
    documentAudioTimeline: documentState ? getDocumentAudioTimeline(documentState) : [],
    activeSceneAudio: normalizeAudioClip(activeScene?.audio),
    audioError,
    reloadExternalChanges,
    openShaderEditor,
    saveShaderDraft,
    formattedCurrentTime: formatTime(store.currentTime),
    store,
  }
}
