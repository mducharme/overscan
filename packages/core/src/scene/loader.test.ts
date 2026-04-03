import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { SceneLoader } from './loader.js'

const minimal = JSON.stringify({
  id: 'test',
  title: 'Test Scene',
  duration: 10,
  bpm: 120,
  rowsPerBeat: 8,
  resolution: { width: 640, height: 360 },
  fps: 30,
  tracks: [],
  graph: {
    nodes: [{ id: 'plasma1', type: 'generator', impl: 'plasma', config: {} }],
    edges: [],
    outputs: { terminal: 'plasma1' },
  },
})

describe('SceneLoader', () => {
  it('parses a valid minimal scene', () => {
    const loader = new SceneLoader()
    const scene = loader.loadJSON(minimal)
    expect(scene.id).toBe('test')
    expect(scene.bpm).toBe(120)
    expect(scene.graph.nodes).toHaveLength(1)
  })

  it('throws on missing required fields', () => {
    const loader = new SceneLoader()
    expect(() => loader.loadJSON('{}')).toThrow('Invalid scene file')
  })

  it('defaults rowsPerBeat to 8', () => {
    const loader = new SceneLoader()
    const json = JSON.stringify({
      id: 'x', title: 'x', duration: 1, bpm: 120,
      resolution: { width: 4, height: 4 }, fps: 30,
      graph: { nodes: [], edges: [], outputs: {} },
    })
    const scene = loader.loadJSON(json)
    expect(scene.rowsPerBeat).toBe(8)
  })

  it('resolves relative asset paths from the source file', () => {
    const loader = new SceneLoader()
    expect(loader.resolveAssetPath('C:/demo/overscan-demo/show.demo.json', './overscan001.mp3'))
      .toBe(resolve('C:/demo/overscan-demo', 'overscan001.mp3'))
    expect(loader.resolveAssetPath('C:/demo/overscan-demo/show.demo.json', '../fire-scroller/scene.json'))
      .toBe(resolve('C:/demo/fire-scroller', 'scene.json'))
  })
})
