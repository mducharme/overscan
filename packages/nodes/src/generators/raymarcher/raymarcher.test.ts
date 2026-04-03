import { describe, expect, it } from 'vitest'
import { BufferPoolImpl, buildSignal } from '@overscan/core'
import type { NodeContext } from '@overscan/types'
import { RaymarcherGenerator } from './index.js'

function makeCtx(pool: BufferPoolImpl): NodeContext {
  return { canvas: null, ctx2d: null, gl: null, pool, width: 16, height: 16 }
}

describe('RaymarcherGenerator', () => {
  it('uses custom scene source in the CPU fallback', () => {
    const pool = new BufferPoolImpl()
    const ctx = makeCtx(pool)
    const genA = RaymarcherGenerator({ scene: 'return 0.0;' })
    const genB = RaymarcherGenerator({ scene: 'return 10.0;' })
    const outA = pool.acquire(16, 16)
    const outB = pool.acquire(16, 16)
    const signal = buildSignal({ t: 1 })

    genA.init(ctx)
    genB.init(ctx)
    genA.render(ctx, outA, signal)
    genB.render(ctx, outB, signal)

    expect(outA.data).not.toEqual(outB.data)
  })

  it('supports the monument-style custom scene used by demo content', () => {
    const pool = new BufferPoolImpl()
    const ctx = makeCtx(pool)
    const gen = RaymarcherGenerator({
      scene: 'vec3 q = p; q.xz *= rot(u_time * 0.08); float pillar1 = sdBox(q - vec3(-1.5, 0.0, 0.0), vec3(0.16, 0.72, 0.18)); float pillar2 = sdBox(q - vec3(-1.0, 0.0, 0.0), vec3(0.16, 0.72, 0.18)); float pillar3 = sdBox(q - vec3(-0.5, 0.0, 0.0), vec3(0.16, 0.72, 0.18)); float pillar4 = sdBox(q - vec3(0.0, 0.0, 0.0), vec3(0.16, 0.72, 0.18)); float pillar5 = sdBox(q - vec3(0.5, 0.0, 0.0), vec3(0.16, 0.72, 0.18)); float pillar6 = sdBox(q - vec3(1.0, 0.0, 0.0), vec3(0.16, 0.72, 0.18)); float pillar7 = sdBox(q - vec3(1.5, 0.0, 0.0), vec3(0.16, 0.72, 0.18)); float cap = sdBox(q - vec3(0.0, 0.78, 0.0), vec3(1.82, 0.08, 0.22)); float base = sdBox(q - vec3(0.0, -0.82, 0.0), vec3(1.96, 0.08, 0.24)); float monument = min(min(min(pillar1, pillar2), min(pillar3, pillar4)), min(min(pillar5, pillar6), pillar7)); monument = min(monument, cap); monument = min(monument, base); float halo = sdTorus(vec3(q.x, q.y * 0.7, q.z), vec2(1.55, 0.09)); return min(monument, halo);',
    })
    const out = pool.acquire(16, 16)

    gen.init(ctx)
    gen.render(ctx, out, buildSignal({ t: 1 }))

    expect(out.data.some(value => value !== 0)).toBe(true)
  })
})
