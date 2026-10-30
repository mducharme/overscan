import { describe, expect, it } from 'vitest'
import type { RocketTrack } from '@overscan/types'
import { clampView, followTime, gridLines, panView, timeTicks, TrackSampler, trackRange, waveformPeaks, zoomView } from './timeline'

describe('time view', () => {
  it('zooms around the anchor and stays inside the document', () => {
    expect(zoomView({ start: 0, end: 10 }, 0.5, 5, 10)).toEqual({ start: 2.5, end: 7.5 })
    expect(zoomView({ start: 0, end: 10 }, 4, 5, 10)).toEqual({ start: 0, end: 10 })
    expect(zoomView({ start: 0, end: 1 }, 0.01, 0.5, 10).end - zoomView({ start: 0, end: 1 }, 0.01, 0.5, 10).start).toBeCloseTo(0.25)
  })

  it('pans without leaving the document', () => {
    expect(panView({ start: 2, end: 4 }, 100, 10)).toEqual({ start: 8, end: 10 })
    expect(panView({ start: 2, end: 4 }, -100, 10)).toEqual({ start: 0, end: 2 })
    expect(clampView({ start: -5, end: 50 }, 10)).toEqual({ start: 0, end: 10 })
  })

  it('pages forward when playback leaves the view', () => {
    expect(followTime({ start: 0, end: 4 }, 3, 20)).toEqual({ start: 0, end: 4 })
    const next = followTime({ start: 0, end: 4 }, 5, 20)
    expect(next.start).toBeLessThan(5)
    expect(next.end - next.start).toBeCloseTo(4)
  })
})

describe('gridLines', () => {
  it('places bars every 4 beats from each span start', () => {
    const lines = gridLines({ start: 0, end: 4 }, 800, [{ start: 0, end: 4, bpm: 120 }])
    expect(lines.filter(l => l.kind === 'bar').map(l => l.t)).toEqual([0, 2])
    expect(lines.filter(l => l.kind === 'beat')).toHaveLength(6)
    const shifted = gridLines({ start: 0, end: 4 }, 800, [{ start: 1.25, end: 4, bpm: 120 }])
    expect(shifted.find(l => l.kind === 'bar')?.t).toBe(1.25)
  })

  it('drops beats and thins bars when zoomed out', () => {
    const lines = gridLines({ start: 0, end: 600 }, 600, [{ start: 0, end: 600, bpm: 120 }])
    expect(lines.every(l => l.kind === 'bar')).toBe(true)
    const gaps = lines.slice(1).map((l, i) => l.t - lines[i]!.t)
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(6 - 1e-9)
  })
})

describe('timeTicks', () => {
  it('picks a readable step', () => {
    expect(timeTicks({ start: 0, end: 10 }, 1000)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(timeTicks({ start: 0, end: 92 }, 800)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90])
  })
})

describe('TrackSampler', () => {
  const track: RocketTrack = { name: 'x', keys: [{ row: 0, value: 0, interpolation: 'linear' }, { row: 16, value: 2, interpolation: 'step' }] }

  it('matches rocket interpolation', () => {
    const s = new TrackSampler([track])
    expect(s.valueAt('x', 8)).toBe(1)
    expect(s.valueAt('x', 40)).toBe(2)
    expect(s.sample('x', 0, 16, 3)).toEqual([0, 1, 2])
    expect(s.valueAt('missing', 3)).toBe(0)
  })

  it('pads value ranges, including flat tracks', () => {
    expect(trackRange(track).min).toBeLessThan(0)
    expect(trackRange(track).max).toBeGreaterThan(2)
    const flat = trackRange({ name: 'f', keys: [{ row: 0, value: 3, interpolation: 'linear' }] })
    expect(flat.max - flat.min).toBeGreaterThan(0)
  })
})

describe('waveformPeaks', () => {
  it('reports min and max per bucket', () => {
    const peaks = waveformPeaks(new Float32Array([0.5, -0.25, 0, 1, -1, 0]), 3)
    expect(Array.from(peaks)).toEqual([-0.25, 0.5, 0, 1, -1, 0])
  })
})
