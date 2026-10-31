import { describe, expect, it } from 'vitest'
import { BufferPoolImpl, buildSignal } from '@overscan/core'
import type { Generator, NodeContext } from '@overscan/types'
import { StarfieldGenerator } from './generators/starfield/index.js'
import { WaterRippleGenerator } from './generators/water-ripple/index.js'
import { GameOfLifeGenerator } from './generators/game-of-life/index.js'
import { MatrixRainGenerator } from './generators/matrix-rain/index.js'
import { LFOSource } from './signals/lfo.js'
import { NoiseSource } from './signals/noise.js'

const W = 160
const H = 90

/** Renders `frames` frames with a fresh instance and returns every frame concatenated. */
function render(make: () => Generator, frames = 12): Uint8ClampedArray {
  const pool = new BufferPoolImpl()
  const ctx: NodeContext = { canvas: null, ctx2d: null, gl: null, pool, width: W, height: H }
  const gen = make()
  gen.init(ctx)
  const all = new Uint8ClampedArray(W * H * 4 * frames)
  for (let f = 0; f < frames; f++) {
    const out = pool.acquire(W, H)
    gen.render(ctx, out, buildSignal({ t: f / 4, frame: f, dt: 1 / 4 }))
    all.set(out.data, f * W * H * 4)
    pool.release(out)
  }
  return all
}

const generators: [string, (seed?: number) => Generator][] = [
  ['starfield', seed => StarfieldGenerator({ warpSpeed: 3, ...(seed === undefined ? {} : { randomSeed: seed }) })],
  ['water-ripple', seed => WaterRippleGenerator({ tapRate: 8, ...(seed === undefined ? {} : { randomSeed: seed }) })],
  ['game-of-life', seed => GameOfLifeGenerator({ seed: 'random', ...(seed === undefined ? {} : { randomSeed: seed }) })],
  ['matrix-rain', seed => MatrixRainGenerator({ glitch: 0.5, ...(seed === undefined ? {} : { randomSeed: seed }) })],
]

describe('deterministic output', () => {
  for (const [name, make] of generators) {
    it(`${name} renders identically across instances, and randomSeed changes it`, () => {
      expect(render(() => make())).toEqual(render(() => make()))
      expect(render(() => make(7))).not.toEqual(render(() => make()))
    })
  }

  it('lfo random shape is reproducible and seek-safe', () => {
    const sample = (times: number[]): number[] => {
      const lfo = LFOSource({ shape: 'random', rate: 2 })
      return times.map(t => lfo.tick(buildSignal({ t }))['value']!)
    }
    const sequential = sample([0, 0.6, 1.2, 1.8, 2.4])
    expect(sample([0, 0.6, 1.2, 1.8, 2.4])).toEqual(sequential)
    expect(sample([2.4])).toEqual([sequential[4]])
  })

  it('noise depends on the time only: seeking and frame rate give the same value', () => {
    const at = (times: number[]): number => {
      const noise = NoiseSource({ frequency: 3 })
      let v = 0
      for (const t of times) v = noise.tick(buildSignal({ t }))['value']!
      return v
    }
    const every60 = Array.from({ length: 151 }, (_, i) => i / 60)
    expect(at(every60)).toBe(at([2.5]))
    expect(at([0.3, 1.1, 2.5])).toBe(at([2.5]))
    expect(NoiseSource({ seed: 2 }).tick(buildSignal({ t: 2.5 }))['value']).not.toBe(at([2.5]))
  })
})
