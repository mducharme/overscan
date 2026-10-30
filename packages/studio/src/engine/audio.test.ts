import { describe, expect, it } from 'vitest'
import { timelineAudio } from './audio'
import type { StudioDocument } from './document'

function demoDocument(): StudioDocument {
  const section = (id: string, start: number, end: number, audio?: unknown) => ({
    id, start, end, title: id, scenePath: `/proj/scenes/${id}.scene.json`, transition: { type: 'cut', duration: 0 },
    scene: { audio },
  })
  return {
    kind: 'demo',
    filePath: '/proj/demo.demo.json',
    demo: { audio: { src: 'music/track.ogg', volume: 0.5 } },
    player: { duration: 20, sections: [section('a', 0, 8), section('b', 8, 20, 'loop.wav')] },
  } as unknown as StudioDocument
}

describe('timelineAudio', () => {
  it('places demo audio across the demo and scene audio in its section, as `overscan run` does', () => {
    expect(timelineAudio(demoDocument())).toEqual([
      { key: 'demo', label: 'track.ogg', path: '/proj/music/track.ogg', start: 0, end: 20, volume: 0.5, rate: 1 },
      { key: 'section:b:8', label: 'b · loop.wav', path: '/proj/scenes/loop.wav', start: 8, end: 20, volume: 1, rate: 1 },
    ])
  })
})
