import { describe, expect, it, vi } from 'vitest'
import type { StudioDocument } from '../engine/document'
import type { Player } from '../engine/player'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseSceneJson } from '@overscan/core/browser'
import type { Scene } from '@overscan/types'
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
  return { kind: 'scene', filePath, text: '{}', mtimeMs: 0, scene: null, demo: null, player, assetProblems: [], sceneFiles: {} }
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
  const text = readFileSync(join(__dirname, '../../../../examples/showcase/03-plasma.scene.json'), 'utf8')
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
      sceneFiles: { [path]: { path, text, savedText: text, mtimeMs: 5 } },
    },
  }
}

describe('editing', () => {
  it('edits the file text in place, updates the player and tracks dirty files', async () => {
    const { document, updates } = editableDocument()
    const store = createStudioStore({ load: async () => document })
    await store.getState().openDocument('/p/plasma.scene.json')
    store.getState().setNodeParam('/p/plasma.scene.json', 'plasma', 'speed', 2.5)
    const file = store.getState().document!.sceneFiles['/p/plasma.scene.json']!
    expect(file.text).toBe(file.savedText.replace('"speed": 1.4', '"speed": 2.5'))
    expect(updates.at(-1)?.graph.nodes[0]?.config.speed).toBe(2.5)
    expect(dirtyFiles(store.getState().document)).toHaveLength(1)
    store.getState().setNodeParam('/p/plasma.scene.json', 'plasma', 'speed', undefined)
    expect(store.getState().document!.sceneFiles['/p/plasma.scene.json']!.text).not.toContain('"speed"')
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
    expect(store.getState().document!.sceneFiles['/p/plasma.scene.json']!.mtimeMs).toBe(9)
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
