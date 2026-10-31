import { createStore, type StoreApi } from 'zustand/vanilla'
import { parseDemoJson, parseSceneJson, validateSceneGraph } from '@overscan/core/browser'
import { buildBuiltinRegistry, NODE_SCHEMAS } from '@overscan/nodes/browser'
import type { Demo, RocketInterpolation, RocketKey, Scene, SceneEdge, SceneNode } from '@overscan/types'
import type { SourceFile, StudioDocument } from '../engine/document'
import { insertJsonValue, removeJsonValue, setJsonValue, type JsonPath } from '../engine/json-edit'
import { relativePath } from '../engine/paths'

export type Renderer = 'ascii' | 'ansi' | '2d' | 'gl'

/** Fraction of the document resolution the 2D/GL preview renders at (lower = faster). */
export type RenderScale = 1 | 0.5 | 0.25

export const MIN_RATE = 0.125
export const MAX_RATE = 8
/** Edits of the same thing closer together than this undo as one step (a slider drag, typing). */
export const COALESCE_MS = 1000
const MAX_HISTORY = 200

/** One undoable change: a file's text before and after. */
export interface HistoryEntry {
  path: string
  before: string
  after: string
  /** What changed, for the undo/redo tooltips. */
  label: string
  /** Edits with the same key in quick succession merge into this entry. */
  coalesce?: string
  at: number
}

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
  /** Undo stack (oldest first) and redo stack (most recently undone last). */
  past: HistoryEntry[]
  future: HistoryEntry[]
}

export interface KeyPatch {
  row?: number
  value?: number
  interpolation?: RocketInterpolation
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
  /**
   * Replaces a file's whole text (the JSON editor). Returns why it was not applied (invalid JSON, a scene
   * that does not validate), or null.
   */
  setFileText(path: string, text: string): string | null
  /**
   * Adds a node. Modifiers and compositors need `after`: they are inserted after that node, taking over
   * what it fed, with every required input wired from it. Returns the new id.
   */
  addNode(scenePath: string, impl: string, after?: string): string | null
  /** Removes a node and its edges, reconnecting what it fed to its own input where it had one. */
  removeNode(scenePath: string, nodeId: string): void
  /** Wires an output into an input, replacing whatever fed that input. */
  connect(scenePath: string, from: { node: string; output: string }, to: { node: string; input: string }): void
  /** Removes the edge at `index` in the scene's edge list. */
  disconnect(scenePath: string, index: number): void
  /** Makes `nodeId` what every sink (terminal, browser, export) shows. */
  setOutput(scenePath: string, nodeId: string): void
  /** Adds a key to a track (replacing a key on the same row). */
  addKey(scenePath: string, track: string, key: RocketKey): void
  /** Changes a key; the row stays between its neighbours. `coalesce` merges a drag into one undo step. */
  updateKey(scenePath: string, track: string, index: number, patch: KeyPatch, coalesce?: string): void
  removeKey(scenePath: string, track: string, index: number): void
  /** Creates a track holding `value` and binds the node option to it, in one undo step. Returns the track name. */
  bindNewTrack(scenePath: string, nodeId: string, key: string, value: number): string | null
  /** Adds an empty track (a unique name based on `name`). Returns the name used. */
  addTrack(scenePath: string, name: string): string | null
  /** Renames a track and every setting bound to it. */
  renameTrack(scenePath: string, from: string, to: string): void
  /** Removes a track; settings bound to it keep its first value as a fixed number. */
  removeTrack(scenePath: string, name: string): void
  /** Sets (or with `undefined`, removes) a value in the demo file, e.g. `['sections', 2, 'duration']`. */
  setDemoValue(path: JsonPath, value: unknown, coalesce?: string): void
  /** Adds a section showing the scene file at `scenePath` after section `index` (-1: first). */
  addSection(index: number, scenePath: string, duration?: number): void
  removeSection(index: number): void
  /** Moves section `index` one place earlier (-1) or later (+1). */
  moveSection(index: number, delta: -1 | 1): void
  /** Adds a demo-wide modifier (applied over every section). */
  addDemoModifier(impl: string): void
  removeDemoModifier(index: number): void
  undo(): void
  redo(): void
  /** Writes every edited file. Refuses files changed on disk since loading unless `force`. */
  save(options?: { force?: boolean }): Promise<void>
  /** Discards unsaved edits by reloading the document from disk (keeps the playhead). */
  revert(): Promise<void>
}

/** Files with unsaved edits. */
export function dirtyFiles(document: StudioDocument | null): SourceFile[] {
  return document ? Object.values(document.files).filter(f => f.text !== f.savedText) : []
}

export type StudioStore = StoreApi<StudioState & StudioActions>

export interface StoreDeps {
  /** Loads a document, from `files` (edited text) where given and from disk otherwise. */
  load(filePath: string, files?: Readonly<Record<string, SourceFile>>): Promise<StudioDocument>
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
  past: [],
  future: [],
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Edits that keep these can swap the scene into the running player; others rebuild the document. */
const sameShape = (a: Scene, b: Scene): boolean =>
  a.duration === b.duration && a.fps === b.fps && a.resolution.width === b.resolution.width && a.resolution.height === b.resolution.height

/** An edit to a scene's text: a series of format-preserving changes, each seeing the previous result. */
class SceneEdit {
  constructor(public text: string) {}
  set(path: JsonPath, value: unknown): this { this.text = setJsonValue(this.text, path, value); return this }
  insert(path: JsonPath, value: unknown, index?: number): this { this.text = insertJsonValue(this.text, path, value, index); return this }
  remove(path: JsonPath): this { this.text = removeJsonValue(this.text, path); return this }
}

class EditRefused extends Error {}
const refuse = (why: string): never => { throw new EditRefused(why) }

function uniqueId(scene: Scene, base: string): string {
  const ids = new Set(scene.graph.nodes.map(n => n.id))
  const stem = base.replace(/[^a-zA-Z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ''))
  if (!ids.has(stem)) return stem
  let i = 2
  while (ids.has(`${stem}${i}`)) i++
  return `${stem}${i}`
}

/** Whether `to` is reachable from `from` along image edges. */
function reaches(edges: readonly SceneEdge[], from: string, to: string): boolean {
  const seen = new Set<string>()
  const stack = [from]
  while (stack.length) {
    const id = stack.pop()!
    if (id === to) return true
    if (seen.has(id)) continue
    seen.add(id)
    for (const e of edges) if (e.from.node === id) stack.push(e.to.node)
  }
  return false
}

/** JSON paths of every `{ "track": name }` binding in the scene's node configs (vectors and nested objects too). */
function trackBindings(scene: Scene, name: string): JsonPath[] {
  const found: JsonPath[] = []
  const walk = (value: unknown, path: (string | number)[]): void => {
    if (Array.isArray(value)) value.forEach((item, i) => { walk(item, [...path, i]) })
    else if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>
      if (record.track === name && typeof record.track === 'string') found.push(path)
      else for (const [key, item] of Object.entries(record)) walk(item, [...path, key])
    }
  }
  scene.graph.nodes.forEach((node, i) => { walk(node.config, ['graph', 'nodes', i, 'config']) })
  return found
}

const nodeIndex = (scene: Scene, nodeId: string): number => {
  const i = scene.graph.nodes.findIndex(n => n.id === nodeId)
  return i >= 0 ? i : refuse(`No node '${nodeId}'`)
}
const trackIndex = (scene: Scene, track: string): number => {
  const i = scene.tracks.findIndex(t => t.name === track)
  return i >= 0 ? i : refuse(`No track '${track}'`)
}

export function createStudioStore(deps: StoreDeps): StudioStore {
  let loadToken = 0
  let rebuildToken = 0
  return createStore<StudioState & StudioActions>()((set, get) => {
    /** Rebuilds the document from the edited files, for edits the running player cannot take in place. */
    const rebuild = async (files: Readonly<Record<string, SourceFile>>): Promise<void> => {
      const token = ++rebuildToken
      const start = get().document
      if (!start) return
      try {
        const next = await deps.load(start.filePath, files)
        const current = get().document
        if (token !== rebuildToken || current?.filePath !== next.filePath) {
          next.player.destroy()
          return
        }
        // Edits made while loading: build again from the newest text.
        if (Object.values(current.files).some(f => f.text !== files[f.path]?.text)) {
          next.player.destroy()
          void rebuild(current.files)
          return
        }
        current.player.destroy()
        // Files the rebuild newly read (an added section's scene) join the ones being edited.
        set({ document: { ...next, files: { ...next.files, ...current.files } }, time: clamp(get().time, 0, next.player.duration), renderError: null })
      } catch (error) {
        if (token === rebuildToken) set({ editError: message(error) })
      }
    }

    /** Validates `text` as the new contents of `path` and shows it. Returns why not, or null. */
    const apply = (path: string, text: string): string | null => {
      const { document } = get()
      const file = document?.files[path]
      if (!document || !file) return `${path} is not part of this document`
      if (text === file.text) return null
      let scene: Scene | null = null
      try {
        if (document.kind === 'demo' && path === document.filePath) parseDemoJson(text)
        else {
          scene = parseSceneJson(text)
          validateSceneGraph(scene.graph, buildBuiltinRegistry(scene.graph.nodes))
        }
      } catch (error) {
        return message(error)
      }
      const files = { ...document.files, [path]: { ...file, text } }
      const previous = document.player.sections.find(s => s.scenePath === path)?.scene
      if (scene && previous && sameShape(previous, scene)) {
        document.player.updateScene(path, scene).catch((error: unknown) => { set({ editError: message(error) }) })
        set({ document: { ...document, ...(document.kind === 'scene' ? { scene } : {}), files } })
      } else {
        set({ document: { ...document, files } })
        void rebuild(files)
      }
      set({ renderError: null, saveError: null })
      return null
    }

    /** Applies an edit and records it for undo. Returns why it was refused, or null. */
    const commit = (path: string, text: string, label: string, coalesce?: string): string | null => {
      const before = get().document?.files[path]?.text
      const error = apply(path, text)
      if (error !== null) return error
      if (before === undefined || before === text) return null
      const { past, future } = get()
      const last = past.at(-1)
      const now = Date.now()
      if (coalesce && last?.coalesce === coalesce && last.path === path && now - last.at < COALESCE_MS && future.length === 0) {
        set({ past: [...past.slice(0, -1), { ...last, after: text, at: now }] })
      } else {
        set({ past: [...past, { path, before, after: text, label, ...(coalesce ? { coalesce } : {}), at: now }].slice(-MAX_HISTORY), future: [] })
      }
      set({ editError: null })
      return null
    }

    /** Runs a structural edit of the scene at `scenePath` against its current text and parsed scene. */
    const editScene = (scenePath: string, label: string, build: (edit: SceneEdit, scene: Scene) => void, coalesce?: string): boolean => {
      const { document } = get()
      const file = document?.files[scenePath]
      const scene = document?.player.sections.find(s => s.scenePath === scenePath)?.scene
      if (!file || !scene) return false
      const edit = new SceneEdit(file.text)
      try {
        build(edit, scene)
      } catch (error) {
        set({ editError: `${label}: ${message(error)}` })
        return false
      }
      const error = commit(scenePath, edit.text, label, coalesce)
      if (error !== null) set({ editError: `${label}: ${error}` })
      return error === null
    }

    /** Runs an edit of the demo file against its current text and parsed demo. */
    const editDemo = (label: string, build: (edit: SceneEdit, demo: Demo) => void, coalesce?: string): boolean => {
      const { document } = get()
      const file = document?.kind === 'demo' ? document.files[document.filePath] : undefined
      if (!document || !file) return false
      const edit = new SceneEdit(file.text)
      try {
        build(edit, parseDemoJson(file.text))
      } catch (error) {
        set({ editError: `${label}: ${message(error)}` })
        return false
      }
      const error = commit(document.filePath, edit.text, label, coalesce)
      if (error !== null) set({ editError: `${label}: ${error}` })
      return error === null
    }

    return {
      ...initialState,

      async openDocument(filePath) {
        const token = ++loadToken
        rebuildToken++
        set({ status: 'loading', error: null, playing: false })
        try {
          const document = await deps.load(filePath)
          // A newer open started while this one loaded: drop this result.
          if (token !== loadToken) {
            document.player.destroy()
            return
          }
          get().document?.player.destroy()
          set({
            status: 'ready', document, time: 0, renderError: null, selectedNodeId: null, selectedSectionId: null,
            editError: null, saveError: null, past: [], future: [],
          })
        } catch (error) {
          if (token !== loadToken) return
          set({ status: 'error', error: message(error) })
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
        editScene(scenePath, `${nodeId}.${key}`, (edit, scene) => {
          const path = ['graph', 'nodes', nodeIndex(scene, nodeId), 'config', key]
          if (value === undefined) edit.remove(path)
          else edit.set(path, value)
        }, `param:${scenePath}:${nodeId}.${key}`)
      },

      // Typing in the editor undoes in bursts, like the inspector's sliders.
      setFileText: (path, text) => commit(path, text, 'JSON edit', `text:${path}`),

      addNode(scenePath, impl, after) {
        const schema = NODE_SCHEMAS[impl]
        if (!schema) {
          set({ editError: `No node type '${impl}'` })
          return null
        }
        const current = get().document?.player.sections.find(s => s.scenePath === scenePath)?.scene
        if (!current) return null
        const id = uniqueId(current, impl)
        const ok = editScene(scenePath, `Add ${schema.label}`, (edit, scene) => {
          const node: SceneNode = { id, type: schema.kind, impl, config: {} }
          const anchor = after ? nodeIndex(scene, after) : -1
          edit.insert(['graph', 'nodes'], node, anchor >= 0 ? anchor + 1 : undefined)
          if (schema.kind !== 'modifier' && schema.kind !== 'compositor') return
          // Modifiers and compositors must be fed to build, so they go after a node.
          if (!after) refuse('select the node to add it after')
          // Take over what the anchor fed (edges and sinks), then feed every required input from it.
          scene.graph.edges.forEach((e, i) => { if (e.from.node === after) edit.set(['graph', 'edges', i, 'from', 'node'], id) })
          for (const [sink, nodeId] of Object.entries(scene.graph.outputs)) if (nodeId === after) edit.set(['graph', 'outputs', sink], id)
          const inputs = schema.kind === 'modifier' ? ['in'] : (schema.inputs ?? ['base']).filter(input => input !== 'mask')
          for (const input of inputs) edit.insert(['graph', 'edges'], { from: { node: after, output: 'color' }, to: { node: id, input } })
        })
        if (!ok) return null
        set({ selectedNodeId: id })
        return id
      },

      removeNode(scenePath, nodeId) {
        editScene(scenePath, `Remove ${nodeId}`, (edit, scene) => {
          const { edges, outputs } = scene.graph
          const incoming = edges.filter(e => e.to.node === nodeId)
          // A node with a single image input is bypassed: what it fed reads from its input instead.
          const bypass = incoming.length === 1 ? incoming[0]!.from.node : null
          for (const [sink, target] of Object.entries(outputs)) {
            if (target !== nodeId) continue
            if (!bypass) refuse(`it is what the ${sink} output shows; make another node the output first`)
            edit.set(['graph', 'outputs', sink], bypass)
          }
          edges.forEach((e, i) => { if (bypass && e.from.node === nodeId) edit.set(['graph', 'edges', i, 'from', 'node'], bypass) })
          for (let i = edges.length - 1; i >= 0; i--) {
            const e = edges[i]!
            if (e.to.node === nodeId || (e.from.node === nodeId && !bypass)) edit.remove(['graph', 'edges', i])
          }
          edit.remove(['graph', 'nodes', nodeIndex(scene, nodeId)])
        })
        if (get().selectedNodeId === nodeId) set({ selectedNodeId: null })
      },

      connect(scenePath, from, to) {
        editScene(scenePath, `Connect ${from.node} → ${to.node}`, (edit, scene) => {
          if (from.node === to.node || reaches(scene.graph.edges, to.node, from.node)) refuse('that would make a loop')
          const edges = scene.graph.edges
          for (let i = edges.length - 1; i >= 0; i--) {
            if (edges[i]!.to.node === to.node && edges[i]!.to.input === to.input) edit.remove(['graph', 'edges', i])
          }
          edit.insert(['graph', 'edges'], { from, to })
        })
      },

      disconnect(scenePath, index) {
        editScene(scenePath, 'Disconnect', (edit, scene) => {
          if (!scene.graph.edges[index]) refuse(`No edge ${index}`)
          edit.remove(['graph', 'edges', index])
        })
      },

      setOutput(scenePath, nodeId) {
        editScene(scenePath, `Output ${nodeId}`, (edit, scene) => {
          nodeIndex(scene, nodeId)
          const sinks = Object.keys(scene.graph.outputs)
          for (const sink of sinks.length ? sinks : ['terminal', 'browser', 'export']) edit.set(['graph', 'outputs', sink], nodeId)
        })
      },

      addKey(scenePath, track, key) {
        editScene(scenePath, `Key on ${track}`, (edit, scene) => {
          const ti = trackIndex(scene, track)
          const keys = scene.tracks[ti]!.keys
          const same = keys.findIndex(k => k.row === key.row)
          if (same >= 0) edit.set(['tracks', ti, 'keys', same], key)
          else {
            const next = keys.findIndex(k => k.row > key.row)
            edit.insert(['tracks', ti, 'keys'], key, next >= 0 ? next : undefined)
          }
        })
      },

      updateKey(scenePath, track, index, patch, coalesce) {
        editScene(scenePath, `Key on ${track}`, (edit, scene) => {
          const ti = trackIndex(scene, track)
          const keys = scene.tracks[ti]!.keys
          const key = keys[index] ?? refuse(`No key ${index} on ${track}`)
          const path = ['tracks', ti, 'keys', index]
          if (patch.row !== undefined) {
            const lo = index > 0 ? keys[index - 1]!.row + 1 : 0
            const hi = index < keys.length - 1 ? keys[index + 1]!.row - 1 : Infinity
            const row = clamp(Math.round(patch.row), lo, hi)
            if (row !== key.row) edit.set([...path, 'row'], row)
          }
          if (patch.value !== undefined && patch.value !== key.value) edit.set([...path, 'value'], patch.value)
          if (patch.interpolation !== undefined && patch.interpolation !== key.interpolation) edit.set([...path, 'interpolation'], patch.interpolation)
        }, coalesce)
      },

      removeKey(scenePath, track, index) {
        editScene(scenePath, `Remove key on ${track}`, (edit, scene) => {
          edit.remove(['tracks', trackIndex(scene, track), 'keys', index])
        })
      },

      bindNewTrack(scenePath, nodeId, key, value) {
        let name: string | null = null
        editScene(scenePath, `Track for ${nodeId}.${key}`, (edit, scene) => {
          const names = new Set(scene.tracks.map(t => t.name))
          const base = `${nodeId}.${key}`
          name = base
          for (let i = 2; names.has(name); i++) name = `${base}${i}`
          edit.insert(['tracks'], { name, keys: [{ row: 0, value, interpolation: 'linear' }] })
          edit.set(['graph', 'nodes', nodeIndex(scene, nodeId), 'config', key], { track: name })
        })
        return name
      },

      addTrack(scenePath, name) {
        let used: string | null = null
        editScene(scenePath, 'Add track', (edit, scene) => {
          const names = new Set(scene.tracks.map(t => t.name))
          used = name
          for (let i = 2; names.has(used); i++) used = `${name}${i}`
          edit.insert(['tracks'], { name: used, keys: [{ row: 0, value: 0, interpolation: 'linear' }] })
        })
        return used
      },

      renameTrack(scenePath, from, to) {
        const name = to.trim()
        if (!name || name === from) return
        editScene(scenePath, `Rename ${from}`, (edit, scene) => {
          if (scene.tracks.some(t => t.name === name)) refuse(`there is already a track '${name}'`)
          edit.set(['tracks', trackIndex(scene, from), 'name'], name)
          for (const path of trackBindings(scene, from)) edit.set([...path, 'track'], name)
        })
      },

      removeTrack(scenePath, name) {
        editScene(scenePath, `Remove ${name}`, (edit, scene) => {
          const ti = trackIndex(scene, name)
          const value = scene.tracks[ti]!.keys[0]?.value ?? 0
          for (const path of trackBindings(scene, name)) edit.set(path, value)
          edit.remove(['tracks', ti])
        })
      },

      setDemoValue(path, value, coalesce) {
        editDemo(`Demo ${path.join('.')}`, edit => {
          if (value === undefined) edit.remove(path)
          else edit.set(path, value)
        }, coalesce ?? `demo:${path.join('.')}`)
      },

      addSection(index, scenePath, duration) {
        const { document } = get()
        if (!document) return
        editDemo('Add section', (edit, demo) => {
          const ids = new Set(demo.sections.map(s => s.id))
          const stem = scenePath.split(/[\\/]/).pop()!.replace(/\.scene\.json$/, '').replace(/^\d+-/, '') || 'section'
          let id = stem
          for (let i = 2; ids.has(id); i++) id = `${stem}${i}`
          const section = { id, scene: relativePath(document.filePath, scenePath), ...(duration ? { duration } : {}) }
          edit.insert(['sections'], section, index + 1)
        })
      },

      removeSection(index) {
        editDemo('Remove section', (edit, demo) => {
          if (demo.sections.length <= 1) refuse('a demo needs at least one section')
          if (!demo.sections[index]) refuse(`No section ${index}`)
          edit.remove(['sections', index])
        })
      },

      moveSection(index, delta) {
        editDemo('Move section', (edit, demo) => {
          const to = index + delta
          const section = demo.sections[index]
          if (!section || to < 0 || to >= demo.sections.length) return
          edit.remove(['sections', index])
          edit.insert(['sections'], section, to)
        })
      },

      addDemoModifier(impl) {
        const schema = NODE_SCHEMAS[impl]
        if (schema?.kind !== 'modifier') {
          set({ editError: `'${impl}' is not a modifier` })
          return
        }
        editDemo(`Add ${schema.label}`, (edit, demo) => {
          const ids = new Set((demo.modifiers ?? []).map(m => m.id))
          let id = impl
          for (let i = 2; ids.has(id); i++) id = `${impl}${i}`
          if (edit.text.includes('"modifiers"')) edit.insert(['modifiers'], { id, impl, config: {} })
          else edit.set(['modifiers'], [{ id, impl, config: {} }])
        })
      },

      removeDemoModifier(index) {
        editDemo('Remove modifier', edit => { edit.remove(['modifiers', index]) })
      },

      undo() {
        const { past, future } = get()
        const entry = past.at(-1)
        if (!entry) return
        const error = apply(entry.path, entry.before)
        if (error !== null) {
          set({ editError: `Undo ${entry.label}: ${error}` })
          return
        }
        set({ past: past.slice(0, -1), future: [...future, entry], editError: null })
      },

      redo() {
        const { past, future } = get()
        const entry = future.at(-1)
        if (!entry) return
        const error = apply(entry.path, entry.after)
        if (error !== null) {
          set({ editError: `Redo ${entry.label}: ${error}` })
          return
        }
        // Not coalescable: a redone step stays a step of its own.
        set({ past: [...past, { ...entry, at: 0 }], future: future.slice(0, -1), editError: null })
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
          const saved: Record<string, SourceFile> = {}
          for (const file of dirty) saved[file.path] = { ...file, savedText: file.text, mtimeMs: await deps.save(file.path, file.text) }
          // Edits made while saving stay dirty: only mark the text we actually wrote as saved.
          const current = get().document
          if (current) {
            const files = { ...current.files }
            for (const [path, file] of Object.entries(saved)) files[path] = { ...files[path]!, savedText: file.savedText, mtimeMs: file.mtimeMs }
            set({ document: { ...current, files } })
          }
          set({ saving: false })
        } catch (error) {
          set({ saving: false, saveError: { message: message(error), conflicts: [] } })
        }
      },

      async revert() {
        const { document, time } = get()
        if (!document) return
        await get().openDocument(document.filePath)
        if (get().document) get().seek(time)
      },
    }
  })
}
