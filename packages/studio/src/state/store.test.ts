import { describe, expect, it, vi } from 'vitest'
import type { StudioDocument } from '../engine/document'
import type { Player } from '../engine/player'
import { createStudioStore, MAX_RATE } from './store'

function fakeDocument(filePath: string, duration = 10): StudioDocument {
  const player: Player = {
    duration,
    fps: 30,
    resolution: { width: 64, height: 36 },
    sections: [],
    sectionAt: () => undefined,
    init: () => {},
    render: () => null,
    destroy: vi.fn(),
  }
  return { kind: 'scene', filePath, text: '{}', mtimeMs: 0, scene: null, demo: null, player, assetProblems: [] }
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
