import { describe, expect, it } from 'vitest'
import { BufferPoolImpl, buildSignal } from '@overscan/core'
import type { Generator, NodeContext } from '@overscan/types'
import { FixedStepClock, frameSteps } from './frame-time.js'
import { FireGenerator } from './generators/fire/index.js'
import { WaterRippleGenerator } from './generators/water-ripple/index.js'
import { GameOfLifeGenerator } from './generators/game-of-life/index.js'

const W = 96
const H = 54

/** Renders the given timeline times with one instance and returns the last frame. */
function renderAt(make: () => Generator, times: number[]): Uint8ClampedArray {
  const pool = new BufferPoolImpl()
  const ctx: NodeContext = { canvas: null, ctx2d: null, gl: null, pool, width: W, height: H }
  const gen = make()
  gen.init(ctx)
  let last = new Uint8ClampedArray(0)
  let prev = 0
  times.forEach((t, f) => {
    const out = pool.acquire(W, H)
    gen.render(ctx, out, buildSignal({ t, frame: f, dt: f === 0 ? 0 : t - prev }))
    last = Uint8ClampedArray.from(out.data)
    pool.release(out)
    prev = t
  })
  return last
}

const at = (fps: number, seconds: number): number[] =>
  Array.from({ length: Math.round(seconds * fps) + 1 }, (_, f) => f * (1 / fps))

const sims: [string, () => Generator][] = [
  ['fire', () => FireGenerator({})],
  ['water-ripple', () => WaterRippleGenerator({ tapRate: 3 })],
  ['game-of-life', () => GameOfLifeGenerator({ seed: 'random', scale: 4 })],
]

describe('frame-rate independence', () => {
  it('frameSteps counts 30 fps reference frames and treats the first frame as one', () => {
    expect(frameSteps(buildSignal({ dt: 1 / 30 }))).toBeCloseTo(1)
    expect(frameSteps(buildSignal({ dt: 1 / 60 }))).toBeCloseTo(0.5)
    expect(frameSteps(buildSignal({ dt: 0 }))).toBe(1)
    expect(frameSteps(buildSignal({ dt: 5 }))).toBeCloseTo(7.5) // capped at 0.25 s
  })

  it('FixedStepClock ticks at 30 Hz and replays after a backward seek', () => {
    const clock = new FixedStepClock()
    const ticks: number[] = []
    let resets = 0
    const run = (t: number): void => clock.advance(t, () => { resets++ }, tick => ticks.push(tick))
    run(0)
    run(0.1)
    expect(ticks.length).toBe(4) // ticks 0..3 cover t = 0.1
    run(0.05)
    expect(resets).toBe(1)
    expect(ticks.slice(4)).toEqual([0, 1 / 30])
  })

  for (const [name, make] of sims) {
    it(`${name} shows the same state at a given time at 30 and 60 fps`, () => {
      expect(renderAt(make, at(60, 2))).toEqual(renderAt(make, at(30, 2)))
    })

    it(`${name} matches a fresh run after seeking backwards`, () => {
      expect(renderAt(make, [...at(30, 2), 1])).toEqual(renderAt(make, at(30, 1)))
    })
  }
})
