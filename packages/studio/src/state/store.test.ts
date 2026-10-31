import { describe, expect, it, vi } from 'vitest'
import type { StudioDocument } from '../engine/document'
import type { Player } from '../engine/player'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseSceneJson } from '@overscan/core/browser'
import type { Demo, Scene } from '@overscan/types'
import type { Bridge } from '../engine/bridge'
import { loadDocument } from '../engine/document'
import { createStudioStore, dirtyFiles, MAX_RATE } from './store'

function fakeDocument(filePath: string, duration = 10): StudioDocument {
  const player: Player = {
    duration,
    fps: 30,
    resolution: { width: 64, height: 36 },
    sections: [],
    version: 0,
    sectionAt: () => undefined,
    init: () => {},
    render: () => null,
    updateScene: () => Promise.resolve(),
    destroy: vi.fn(),
  }
  return { kind: 'scene', filePath, text: '{}', mtimeMs: 0, scene: null, demo: null, player, assetProblems: [], files: {} }
}

describe('studio store', () => {
  it('opens a document and reports load errors', async () => {
    const store = createStudioStore({ load: async path => (path === 'bad' ? Promise.reject(new Error('nope')) : fakeDocument(path)) })
    await store.getState().openDocument('a.scene.json')
    expect(store.getState()).toMatchObject({ status: 'ready', error: null })
    await store.getState().openDocument('bad')
    expect(store.getState()).toMatchObject({ status: 'error', error: 'nope' })
  })

  it('keeps only the most recent of overlapping opens', async () => {
    let resolveFirst: (doc: StudioDocument) => void = () => {}
    const first = fakeDocument('first')
    const store = createStudioStore({
      load: path => (path === 'first' ? new Promise(r => { resolveFirst = r }) : Promise.resolve(fakeDocument(path))),
    })
    const slow = store.getState().openDocument('first')
    await store.getState().openDocument('second')
    resolveFirst(first)
    await slow
    expect(store.getState().document?.filePath).toBe('second')
    expect(first.player.destroy).toHaveBeenCalled()
  })

  it('advances while playing, loops, or stops at the end', async () => {
    const store = createStudioStore({ load: async path => fakeDocument(path, 10) })
    await store.getState().openDocument('a')
    const s = store.getState
    s().advance(1)
    expect(s().time).toBe(0) // paused: no movement
    s().play()
    s().setRate(2)
    s().advance(1)
    expect(s().time).toBe(2)
    s().advance(4.5)
    expect(s().time).toBe(1) // 2 + 9 = 11 wraps to 1
    s().setLoop(false)
    s().advance(20)
    expect(s()).toMatchObject({ time: 10, playing: false })
    s().play()
    expect(s().time).toBe(0) // play at the end restarts
  })

  it('clamps seek and rate', async () => {
    const store = createStudioStore({ load: async path => fakeDocument(path, 10) })
    await store.getState().openDocument('a')
    store.getState().seek(-3)
    expect(store.getState().time).toBe(0)
    store.getState().seek(99)
    expect(store.getState().time).toBe(10)
    store.getState().setRate(100)
    expect(store.getState().rate).toBe(MAX_RATE)
  })
})

describe('render errors', () => {
  it('pause playback and clear on seek', async () => {
    const store = createStudioStore({ load: async path => fakeDocument(path, 10) })
    await store.getState().openDocument('a')
    store.getState().play()
    store.getState().reportRenderError("Node 'x' failed: boom")
    expect(store.getState()).toMatchObject({ playing: false, renderError: "Node 'x' failed: boom" })
    store.getState().seek(2)
    expect(store.getState().renderError).toBeNull()
  })
})

/** A real scene file behind a fake player that records scene updates like the real one. */
function editableDocument(path = '/p/plasma.scene.json'): { document: StudioDocument; updates: Scene[] } {
  const text = readFileSync(join(__dirname, '../../../../examples/advanced/plasma-lens.scene.json'), 'utf8')
  const scene = parseSceneJson(text)
  const updates: Scene[] = []
  let sections = [{ id: scene.id, title: scene.title, start: 0, end: scene.duration, scenePath: path, scene, transition: { type: 'cut', duration: 0 } }]
  const player: Player = {
    duration: scene.duration, fps: 30, resolution: scene.resolution,
    get sections() { return sections },
    version: 0,
    sectionAt: () => sections[0],
    init: () => {},
    render: () => null,
    updateScene(_path, next) {
      updates.push(next)
      sections = sections.map(s => ({ ...s, scene: next }))
      return next.graph.nodes.some(n => n.config.boom) ? Promise.reject(new Error('cannot build')) : Promise.resolve()
    },
    destroy: vi.fn(),
  }
  return {
    updates,
    document: {
      kind: 'scene', filePath: path, text, mtimeMs: 5, scene, demo: null, player, assetProblems: [],
      files: { [path]: { path, text, savedText: text, mtimeMs: 5 } },
    },
  }
}

describe('editing', () => {
  it('edits the file text in place, updates the player and tracks dirty files', async () => {
    const { document, updates } = editableDocument()
    const store = createStudioStore({ load: async () => document })
    await store.getState().openDocument('/p/plasma.scene.json')
    store.getState().setNodeParam('/p/plasma.scene.json', 'plasma', 'speed', 2.5)
    const file = store.getState().document!.files['/p/plasma.scene.json']!
    expect(file.text).toBe(file.savedText.replace('"speed": 1.4', '"speed": 2.5'))
    expect(updates.at(-1)?.graph.nodes[0]?.config.speed).toBe(2.5)
    expect(dirtyFiles(store.getState().document)).toHaveLength(1)
    store.getState().setNodeParam('/p/plasma.scene.json', 'plasma', 'speed', undefined)
    expect(store.getState().document!.files['/p/plasma.scene.json']!.text).not.toContain('"speed"')
  })

  it('saves dirty files, and refuses files changed on disk unless forced', async () => {
    const { document } = editableDocument()
    const save = vi.fn(async () => 9)
    let diskMtime = 5
    const store = createStudioStore({ load: async () => document, save, stat: async () => diskMtime })
    await store.getState().openDocument('/p/plasma.scene.json')
    store.getState().setNodeParam('/p/plasma.scene.json', 'lens', 'zoom', 3)
    diskMtime = 7
    await store.getState().save()
    expect(save).not.toHaveBeenCalled()
    expect(store.getState().saveError?.conflicts).toEqual(['/p/plasma.scene.json'])
    await store.getState().save({ force: true })
    expect(save).toHaveBeenCalledWith('/p/plasma.scene.json', expect.stringContaining('"zoom": 3'))
    expect(dirtyFiles(store.getState().document)).toHaveLength(0)
    expect(store.getState().document!.files['/p/plasma.scene.json']!.mtimeMs).toBe(9)
    expect(store.getState().saveError).toBeNull()
  })

  it('reports edits the player cannot build', async () => {
    const { document } = editableDocument()
    const store = createStudioStore({ load: async () => document })
    await store.getState().openDocument('/p/plasma.scene.json')
    store.getState().setNodeParam('/p/plasma.scene.json', 'plasma', 'boom', true)
    await new Promise(r => setTimeout(r, 0))
    expect(store.getState().editError).toContain('cannot build')
  })
})

async function openEditable() {
  const { document, updates } = editableDocument()
  const load = vi.fn(async () => document)
  const store = createStudioStore({ load })
  await store.getState().openDocument('/p/plasma.scene.json')
  const text = () => store.getState().document!.files['/p/plasma.scene.json']!.text
  const scene = () => JSON.parse(text()) as Scene
  return { store, s: store.getState, text, scene, updates, load, original: document.files['/p/plasma.scene.json']!.text }
}
const P = '/p/plasma.scene.json'

describe('undo and redo', () => {
  it('steps back and forward through edits, merging quick edits of the same option', async () => {
    const { s, text, original } = await openEditable()
    s().setNodeParam(P, 'plasma', 'speed', 2)
    s().setNodeParam(P, 'plasma', 'speed', 3)
    s().setNodeParam(P, 'lens', 'zoom', 1)
    expect(s().past).toHaveLength(2)
    s().undo()
    expect(text()).toContain('"zoom": 2.2')
    expect(text()).toContain('"speed": 3')
    s().undo()
    expect(text()).toBe(original)
    s().redo()
    expect(text()).toContain('"speed": 3')
    // A new edit clears the redo stack.
    s().setNodeParam(P, 'plasma', 'scale', 1)
    expect(s().future).toHaveLength(0)
  })

  it('undoes JSON edits and refuses invalid ones', async () => {
    const { s, text, original } = await openEditable()
    expect(s().setFileText(P, '{ nope')).toMatch(/JSON|Unexpected|position/i)
    expect(text()).toBe(original)
    expect(s().setFileText(P, original.replace('"chroma": 0.8', '"chroma": 0.1'))).toBeNull()
    s().undo()
    expect(text()).toBe(original)
  })

  it('rebuilds the document when the scene changes shape', async () => {
    const { s, load, original } = await openEditable()
    s().setFileText(P, original.replace('"duration": 6', '"duration": 4'))
    expect(load).toHaveBeenLastCalledWith(P, expect.objectContaining({ [P]: expect.objectContaining({ text: expect.stringContaining('"duration": 4') }) }))
  })
})

describe('graph and keyframe edits', () => {
  it('inserts a modifier after a node, taking over its outputs, and removes it again', async () => {
    const { s, scene, text, original } = await openEditable()
    const id = s().addNode(P, 'glow', 'lens')
    expect(id).toBe('glow')
    expect(s().selectedNodeId).toBe('glow')
    expect(scene().graph.outputs.browser).toBe('glow')
    expect(scene().graph.edges).toContainEqual({ from: { node: 'lens', output: 'color' }, to: { node: 'glow', input: 'in' } })
    expect(s().addNode(P, 'glow')).toBeNull()
    expect(s().editError).toContain('select the node')
    expect(s().addNode(P, 'glow', 'glow')).toBe('glow2')
    s().removeNode(P, 'glow2')
    s().removeNode(P, 'glow')
    expect(scene().graph.outputs.browser).toBe('lens')
    expect(scene().graph.edges).toHaveLength(1)
    s().undo()
    s().undo()
    s().undo()
    s().undo()
    expect(text()).toBe(original)
  })

  it('bypasses a removed modifier and refuses to remove an output with nothing to fall back on', async () => {
    const { s, scene } = await openEditable()
    s().removeNode(P, 'lens')
    expect(scene().graph.outputs.terminal).toBe('plasma')
    expect(scene().graph.edges).toEqual([])
    s().removeNode(P, 'plasma')
    expect(s().editError).toContain('output')
    expect(scene().graph.nodes).toHaveLength(1)
  })

  it('connects ports, replacing what fed the input, and refuses loops and missing inputs', async () => {
    const { s, scene } = await openEditable()
    s().addNode(P, 'starfield')
    s().connect(P, { node: 'starfield', output: 'color' }, { node: 'lens', input: 'in' })
    expect(scene().graph.edges).toEqual([{ from: { node: 'starfield', output: 'color' }, to: { node: 'lens', input: 'in' } }])
    s().addNode(P, 'glow', 'lens')
    s().connect(P, { node: 'glow', output: 'color' }, { node: 'lens', input: 'in' })
    expect(s().editError).toContain('loop')
    s().disconnect(P, 0)
    expect(s().editError).toContain('missing its input')
    s().setOutput(P, 'starfield')
    expect(Object.values(scene().graph.outputs)).toEqual(['starfield', 'starfield', 'starfield'])
  })

  it('adds, moves (between neighbours), retimes and removes keys', async () => {
    const { s, scene } = await openEditable()
    s().addKey(P, 'lens.x', { row: 24, value: 0.5, interpolation: 'linear' })
    expect(scene().tracks[0]!.keys.map(k => k.row)).toEqual([0, 24, 48, 96])
    s().updateKey(P, 'lens.x', 1, { row: 70, value: 0.6 }, 'drag')
    expect(scene().tracks[0]!.keys[1]).toEqual({ row: 47, value: 0.6, interpolation: 'linear' })
    s().updateKey(P, 'lens.x', 1, { interpolation: 'step' })
    s().removeKey(P, 'lens.x', 1)
    expect(scene().tracks[0]!.keys.map(k => k.row)).toEqual([0, 48, 96])
    expect(s().bindNewTrack(P, 'lens', 'zoom', 2.2)).toBe('lens.zoom')
    expect(scene().graph.nodes[1]!.config.zoom).toEqual({ track: 'lens.zoom' })
    expect(scene().tracks.at(-1)).toEqual({ name: 'lens.zoom', keys: [{ row: 0, value: 2.2, interpolation: 'linear' }] })
  })
})

describe('tracks', () => {
  it('renames a track with its bindings and removes one, keeping its first value', async () => {
    const { s, scene } = await openEditable()
    s().renameTrack(P, 'lens.x', 'lens.cx')
    expect(scene().tracks[0]!.name).toBe('lens.cx')
    expect(scene().graph.nodes[1]!.config.centerX).toEqual({ track: 'lens.cx' })
    s().renameTrack(P, 'lens.cx', 'lens.y')
    expect(s().editError).toContain('already')
    s().removeTrack(P, 'lens.y')
    expect(scene().tracks.map(t => t.name)).toEqual(['lens.cx'])
    expect(scene().graph.nodes[1]!.config.centerY).toBe(0.35)
    expect(s().addTrack(P, 'lens.cx')).toBe('lens.cx2')
  })
})

describe('demo edits', () => {
  const EXAMPLES = join(__dirname, '../../../../examples')
  const DEMO = join(EXAMPLES, 'showcase.demo.json')
  const fsBridge: Bridge = {
    async read(filePath) {
      return { filePath, text: readFileSync(filePath, 'utf8'), mtimeMs: 1 }
    },
    save: () => Promise.reject(new Error('read-only')),
    stat: async () => 1,
    readBinary: async filePath => new Uint8Array(readFileSync(filePath)),
    mediaUrl: filePath => filePath,
  }
  /** Waits for the rebuild an edit starts: the player is replaced. */
  const rebuilt = async (store: ReturnType<typeof createStudioStore>, player: Player): Promise<void> => {
    for (let i = 0; i < 200 && store.getState().document!.player === player; i++) await new Promise(r => setTimeout(r, 10))
    expect(store.getState().document!.player).not.toBe(player)
  }

  it('edits sections and settings in the demo file and rebuilds the player', async () => {
    const store = createStudioStore({ load: (path, files) => loadDocument(fsBridge, path, files ? { files } : {}) })
    await store.getState().openDocument(DEMO)
    const s = store.getState
    const demo = () => JSON.parse(s().document!.files[DEMO]!.text) as Demo
    const original = s().document!.files[DEMO]!.text

    let player = s().document!.player
    s().setDemoValue(['sections', 0, 'duration'], 4)
    await rebuilt(store, player)
    expect(s().document!.player.sections[0]!.end).toBe(4)
    expect(s().document!.files[DEMO]!.text).toBe(original.replace('"duration": 7.8', '"duration": 4'))

    player = s().document!.player
    s().addSection(0, join(EXAMPLES, 'generators', 'plasma.scene.json'), 3)
    await rebuilt(store, player)
    expect(demo().sections[1]).toEqual({ id: 'plasma', scene: './generators/plasma.scene.json', duration: 3 })
    expect(s().document!.player.sections[1]!.scenePath).toBe(join(EXAMPLES, 'generators', 'plasma.scene.json'))
    expect(Object.keys(s().document!.files)).toContain(join(EXAMPLES, 'generators', 'plasma.scene.json'))

    s().moveSection(1, -1)
    expect(demo().sections.map(x => x.id).slice(0, 2)).toEqual(['plasma', 'boot'])
    s().removeSection(0)
    s().addDemoModifier('glow')
    expect(demo().modifiers?.map(m => m.id)).toEqual(['crt', 'glow'])
    s().removeDemoModifier(1)
    s().setDemoValue(['sections', 0, 'duration'], 7.8)
    expect(s().document!.files[DEMO]!.text).toBe(original)
    s().setDemoValue(['sections', 0, 'duration'], undefined)
    expect(demo().sections[0]).toEqual({ id: 'boot', scene: './showcase/01-boot.scene.json', transition: { type: 'flash', duration: 0.3 } })
  }, 20_000)
})
