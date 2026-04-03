import { describe, expect, it } from 'vitest'
import { BufferPoolImpl, buildSignal } from '@overscan/core'
import type { NodeContext } from '@overscan/types'
import { buildBuiltinRegistry } from '../registry.js'
import { AnsiArtModifier } from './ansi-art.js'
import { EmbossModifier } from './emboss.js'

function makeCtx(pool: BufferPoolImpl, width = 8, height = 8): NodeContext {
  return { canvas: null, ctx2d: null, gl: null, pool, width, height }
}

describe('stylize modifiers', () => {
  it('registers ansi-art and emboss builtins', () => {
    const registry = buildBuiltinRegistry([
      { id: 'ansi', type: 'modifier', impl: 'ansi-art', config: {} },
      { id: 'embossed', type: 'modifier', impl: 'emboss', config: {} },
    ])

    expect(registry.get('ansi')?.id).toBe('ansi-art')
    expect(registry.get('embossed')?.id).toBe('emboss')
  })

  it('emboss produces a directional relief image', () => {
    const pool = new BufferPoolImpl()
    const ctx = makeCtx(pool)
    const mod = EmbossModifier({ angle: 0, strength: 1 })
    mod.init(ctx)

    const input = pool.acquire(8, 8)
    const output = pool.acquire(8, 8)
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const i = (y * 8 + x) * 4
        const value = x * 32
        input.data[i] = value
        input.data[i + 1] = value
        input.data[i + 2] = value
        input.data[i + 3] = 255
      }
    }

    mod.apply(ctx, input, output, buildSignal())

    expect(output.data[0]).toBeLessThan(output.data[(4 * 8 + 4) * 4] ?? 255)
    expect(output.data[3]).toBe(255)
  })

  it('ansi-art rasterizes source pixels into character cells', () => {
    const pool = new BufferPoolImpl()
    const ctx = makeCtx(pool, 12, 8)
    const mod = AnsiArtModifier({ charset: 'ascii', colorMode: 'mono' })
    mod.init(ctx)

    const input = pool.acquire(12, 8)
    const output = pool.acquire(12, 8)
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 12; x++) {
        const i = (y * 12 + x) * 4
        const value = x < 6 ? 24 : 232
        input.data[i] = value
        input.data[i + 1] = value
        input.data[i + 2] = value
        input.data[i + 3] = 255
      }
    }

    mod.apply(ctx, input, output, buildSignal())

    const litPixels = output.data.filter((value, index) => index % 4 !== 3 && value > 0).length
    expect(litPixels).toBeGreaterThan(0)
    expect(output.data.some((value, index) => index % 4 !== 3 && value === 0)).toBe(true)
  })
})
