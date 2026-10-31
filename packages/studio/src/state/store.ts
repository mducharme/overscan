import { createStore, type StoreApi } from 'zustand/vanilla'
import { parseSceneJson } from '@overscan/core/browser'
import type { SceneFile, StudioDocument } from '../engine/document'
import { removeJsonValue, setJsonValue } from '../engine/json-edit'

export type Renderer = 'ascii' | 'ansi' | '2d' | 'gl'

/** Fraction of the document resolution the 2D/GL preview renders at (lower = faster). */
export type RenderScale = 1 | 0.5 | 0.25

export const MIN_RATE = 0.125
export const MAX_RATE = 8

export interface StudioState {
  // Document
  status: 'idle' | 'loading' | 'ready' | 'error'
  document: StudioDocument | null
  error: string | null
  // Playback
  time: number
  playing: boolean
  rate: number
  loop: boolean
  muted: boolean
  renderer: Renderer
  renderScale: RenderScale
  /** Last rendering failure (a node threw); cleared on seek, renderer change or reload. */
  renderError: string | null
  // Selection
  selectedNodeId: string | null
  selectedSectionId: string | null
  // Editing
  /** Last edit that could not be applied (bad value, graph that does not build). */
  editError: string | null
  saving: boolean
  /** Why the last save failed; `conflicts` lists files changed on disk since they were loaded. */
  saveError: { message: string; conflicts: string[] } | null
}

export interface StudioActions {
  openDocument(filePath: string): Promise<void>
  play(): void
  pause(): void
  togglePlay(): void
  /** Jump to `time` seconds, clamped to the document. */
  seek(time: number): void
  setRate(rate: number): void
  setLoop(loop: boolean): void
  setMuted(muted: boolean): void
  setRenderer(renderer: Renderer): void
  setRenderScale(scale: RenderScale): void
  /** Report a rendering failure: playback pauses and the UI shows the message. */
  reportRenderError(message: string | null): void
  selectNode(nodeId: string | null): void
  selectSection(sectionId: string | null): void
  /** Advance playback by `dt` real seconds (called by the playback driver each animation frame). */
  advance(dt: number): void
  /**
   * Sets one config option of a node in the scene file at `scenePath` (`undefined` removes it, so the
   * default applies). The file text is edited in place, keeping its formatting, and the preview updates.
   */
  setNodeParam(scenePath: string, nodeId: string, key: string, value: unknown): void
  /** Writes every edited scene file. Refuses files changed on disk since loading unless `force`. */
  save(options?: { force?: boolean }): Promise<void>
  /** Discards unsaved edits by reloading the document from disk (keeps the playhead). */
  revert(): Promise<void>
}

/** Scene files with unsaved edits. */
export function dirtyFiles(document: StudioDocument | null): SceneFile[] {
  return document ? Object.values(document.sceneFiles).filter(f => f.text !== f.savedText) : []
}

export type StudioStore = StoreApi<StudioState & StudioActions>

export interface StoreDeps {
  load(filePath: string): Promise<StudioDocument>
  /** Writes a file and returns its new modification time. */
  save?(filePath: string, text: string): Promise<number>
  /** Current modification time of a file on disk. */
  stat?(filePath: string): Promise<number>
}

const initialState: StudioState = {
  status: 'idle',
  document: null,
  error: null,
  time: 0,
  playing: false,
  rate: 1,
  loop: true,
  muted: false,
  renderer: 'ansi',
  renderScale: 1,
  renderError: null,
  selectedNodeId: null,
  selectedSectionId: null,
  editError: null,
  saving: false,
  saveError: null,
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

export function createStudioStore(deps: StoreDeps): StudioStore {
  let loadToken = 0
  return createStore<StudioState & StudioActions>()((set, get) => ({
    ...initialState,

    async openDocument(filePath) {
      const token = ++loadToken
      set({ status: 'loading', error: null, playing: false })
      try {
        const document = await deps.load(filePath)
        // A newer open started while this one loaded: drop this result.
        if (token !== loadToken) {
          document.player.destroy()
          return
        }
        get().document?.player.destroy()
        set({ status: 'ready', document, time: 0, renderError: null, selectedNodeId: null, selectedSectionId: null, editError: null, saveError: null })
      } catch (error) {
        if (token !== loadToken) return
        set({ status: 'error', error: error instanceof Error ? error.message : String(error) })
      }
    },

    play() {
      const { document, time } = get()
      if (!document) return
      // Playing from the very end restarts, like a media player.
      set({ playing: true, time: time >= document.player.duration ? 0 : time })
    },
    pause: () => { set({ playing: false }); },
    togglePlay() {
      if (get().playing) get().pause()
      else get().play()
    },

    seek(time) {
      const duration = get().document?.player.duration ?? 0
      set({ time: clamp(time, 0, duration), renderError: null })
    },
    setRate: rate => { set({ rate: clamp(rate, MIN_RATE, MAX_RATE) }); },
    setLoop: loop => { set({ loop }); },
    setMuted: muted => { set({ muted }); },
    setRenderer: renderer => { set({ renderer, renderError: null }); },
    setRenderScale: renderScale => { set({ renderScale }); },
    reportRenderError(message) {
      set(message ? { renderError: message, playing: false } : { renderError: null })
    },
    selectNode: selectedNodeId => { set({ selectedNodeId }); },
    selectSection: selectedSectionId => { set({ selectedSectionId }); },

    advance(dt) {
      const { playing, document, time, rate, loop } = get()
      if (!playing || !document) return
      const duration = document.player.duration
      const next = time + dt * rate
      if (next < duration) set({ time: next })
      else if (loop && duration > 0) set({ time: next % duration })
      else set({ time: duration, playing: false })
    },

    setNodeParam(scenePath, nodeId, key, value) {
      const { document } = get()
      const file = document?.sceneFiles[scenePath]
      const section = document?.player.sections.find(s => s.scenePath === scenePath)
      if (!document || !file || !section) return
      const index = section.scene.graph.nodes.findIndex(n => n.id === nodeId)
      if (index < 0) return
      const path = ['graph', 'nodes', index, 'config', key]
      let text: string
      let scene
      try {
        text = value === undefined ? removeJsonValue(file.text, path) : setJsonValue(file.text, path, value)
        scene = parseSceneJson(text)
      } catch (error) {
        set({ editError: `${nodeId}.${key}: ${error instanceof Error ? error.message : String(error)}` })
        return
      }
      document.player.updateScene(scenePath, scene).then(
        () => { if (get().editError) set({ editError: null }) },
        (error: unknown) => { set({ editError: `${nodeId}.${key}: ${error instanceof Error ? error.message : String(error)}` }) },
      )
      set({
        document: {
          ...document,
          ...(document.kind === 'scene' ? { scene } : {}),
          sceneFiles: { ...document.sceneFiles, [scenePath]: { ...file, text } },
        },
        renderError: null,
        saveError: null,
      })
    },

    async save(options = {}) {
      const { document, saving } = get()
      const dirty = dirtyFiles(document)
      if (!document || saving || dirty.length === 0) return
      if (!deps.save) {
        set({ saveError: { message: 'Saving needs the dev server (overscan dev).', conflicts: [] } })
        return
      }
      set({ saving: true, saveError: null })
      try {
        if (!options.force && deps.stat) {
          const conflicts: string[] = []
          for (const file of dirty) if ((await deps.stat(file.path)) !== file.mtimeMs) conflicts.push(file.path)
          if (conflicts.length) {
            set({ saving: false, saveError: { message: 'Changed on disk since it was opened.', conflicts } })
            return
          }
        }
        const saved: Record<string, SceneFile> = {}
        for (const file of dirty) saved[file.path] = { ...file, savedText: file.text, mtimeMs: await deps.save(file.path, file.text) }
        // Edits made while saving stay dirty: only mark the text we actually wrote as saved.
        const current = get().document
        if (current) {
          const sceneFiles = { ...current.sceneFiles }
          for (const [path, file] of Object.entries(saved)) sceneFiles[path] = { ...sceneFiles[path]!, savedText: file.savedText, mtimeMs: file.mtimeMs }
          set({ document: { ...current, sceneFiles } })
        }
        set({ saving: false })
      } catch (error) {
        set({ saving: false, saveError: { message: error instanceof Error ? error.message : String(error), conflicts: [] } })
      }
    },

    async revert() {
      const { document, time } = get()
      if (!document) return
      await get().openDocument(document.filePath)
      if (get().document) get().seek(time)
    },
  }))
}
