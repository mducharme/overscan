import { describe, expect, it } from 'vitest'
import { parseDemoJson, parseSceneJson } from './parse.js'

describe('parseSceneJson', () => {
  it('supports object-based audio settings', () => {
    const scene = parseSceneJson(JSON.stringify({
      id: 'scene-audio',
      title: 'Scene Audio',
      duration: 4,
      bpm: 120,
      rowsPerBeat: 8,
      audio: {
        src: './fx.wav',
        volume: 0.65,
        pitch: 1.1,
      },
      resolution: { width: 64, height: 64 },
      fps: 60,
      tracks: [],
      graph: {
        nodes: [],
        edges: [],
        outputs: {},
      },
    }))

    expect(scene.audio).toEqual({
      src: './fx.wav',
      volume: 0.65,
      pitch: 1.1,
    })
  })
})

describe('parseDemoJson', () => {
  it('supports structured demo audio and post modifiers', () => {
    const demo = parseDemoJson(JSON.stringify({
      id: 'demo-audio',
      title: 'Demo Audio',
      audio: {
        src: './music.mp3',
        volume: 0.8,
        pitch: 0.95,
      },
      modifiers: [
        {
          id: 'crt1',
          impl: 'crt',
          enabled: true,
          config: { curvature: 0.2 },
        },
      ],
      sections: [
        { id: 'intro', scene: './intro.scene.json' },
      ],
    }))

    expect(demo.audio).toEqual({
      src: './music.mp3',
      volume: 0.8,
      pitch: 0.95,
    })
    expect(demo.modifiers).toEqual([
      {
        id: 'crt1',
        impl: 'crt',
        enabled: true,
        config: { curvature: 0.2 },
      },
    ])
  })

  it('keeps string audio syntax backward compatible', () => {
    const demo = parseDemoJson(JSON.stringify({
      id: 'demo-legacy-audio',
      title: 'Legacy Demo Audio',
      audio: './music.mp3',
      sections: [
        { id: 'intro', scene: './intro.scene.json' },
      ],
    }))

    expect(demo.audio).toBe('./music.mp3')
    expect(demo.modifiers).toEqual([])
  })
})
