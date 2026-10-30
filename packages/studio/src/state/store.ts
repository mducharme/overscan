import { createStore, type StoreApi } from 'zustand/vanilla'
import type { StudioDocument } from '../engine/document'

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
  renderer: Renderer
  renderScale: RenderScale
  /** Last rendering failure (a node threw); cleared on seek, renderer change or reload. */
  renderError: string | null
  // Selection
  selectedNodeId: string | null
  selectedSectionId: string | null
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
  setRenderer(renderer: Renderer): void
  setRenderScale(scale: RenderScale): void
  /** Report a rendering failure: playback pauses and the UI shows the message. */
  reportRenderError(message: string | null): void
  selectNode(nodeId: string | null): void
  selectSection(sectionId: string | null): void
  /** Advance playback by `dt` real seconds (called by the playback driver each animation frame). */
  advance(dt: number): void
}

export type StudioStore = StoreApi<StudioState & StudioActions>

export interface StoreDeps {
  load(filePath: string): Promise<StudioDocument>
}

const initialState: StudioState = {
  status: 'idle',
  document: null,
  error: null,
  time: 0,
  playing: false,
  rate: 1,
  loop: true,
  renderer: 'ansi',
  renderScale: 1,
  renderError: null,
  selectedNodeId: null,
  selectedSectionId: null,
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
        set({ status: 'ready', document, time: 0, renderError: null, selectedNodeId: null, selectedSectionId: null })
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
  }))
}
