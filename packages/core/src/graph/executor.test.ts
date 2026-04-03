import { describe, it, expect } from 'vitest'
import { GraphExecutor, validateSceneGraph } from './executor.js'
import { BufferPoolImpl } from '../buffer/pool.js'
import { buildSignal } from '../signal/builder.js'
import type { DemoNode, Generator, NodeContext, FrameBuffer, Signal } from '@overscan/types'

function makeCtx(pool: BufferPoolImpl): NodeContext {
  return {
    canvas: null, ctx2d: null, gl: null,
    pool, width: 4, height: 4,
  }
}

function makeGenerator(id: string, color: number): Generator {
  return {
    type: 'generator',
    id,
    renderers: ['cpu'],
    config: {},
    init: () => {},
    render: (_ctx, out) => { out.data.fill(color) },
    destroy: () => {},
  }
}

describe('GraphExecutor', () => {
  it('executes a single generator', () => {
    const pool = new BufferPoolImpl()
    const exec = new GraphExecutor()
    const gen = makeGenerator('gen1', 42)

    exec.load(
      { nodes: [{ id: 'gen1', type: 'generator', impl: 'test', config: {} }], edges: [], outputs: { terminal: 'gen1' } },
      new Map([['gen1', gen]]),
    )
    exec.init(makeCtx(pool))

    const signal = buildSignal()
    const ctx = makeCtx(pool)
    const out = exec.tick(ctx, signal, pool, 'gen1')

    expect(out.data[0]).toBe(42)
  })

  it('detects cycles', () => {
    const exec = new GraphExecutor()
    const modifier: DemoNode = {
      type: 'modifier',
      id: 'test',
      persistent: false,
      config: {},
      init: () => {},
      apply: () => {},
      destroy: () => {},
    }
    expect(() =>
      exec.load(
        {
          nodes: [
            { id: 'a', type: 'modifier', impl: 'test', config: {} },
            { id: 'b', type: 'modifier', impl: 'test', config: {} },
          ],
          edges: [
            { from: { node: 'a', output: 'color' }, to: { node: 'b', input: 'color' } },
            { from: { node: 'b', output: 'color' }, to: { node: 'a', input: 'color' } },
          ],
          outputs: { terminal: 'b' },
        },
        new Map([
          ['a', modifier],
          ['b', modifier],
        ]),
      )
    ).toThrow('cycle')
  })

  it('renders a visible placeholder when a node fails in preview mode', () => {
    const pool = new BufferPoolImpl()
    const exec = new GraphExecutor()
    const broken: DemoNode = {
      type: 'generator',
      id: 'broken',
      renderers: ['cpu'],
      config: {},
      init: () => {},
      render: () => {
        throw new Error('boom')
      },
      destroy: () => {},
    }
    exec.load(
      { nodes: [{ id: 'broken', type: 'generator', impl: 'test', config: {} }], edges: [], outputs: { terminal: 'broken' } },
      new Map([['broken', broken]]),
    )
    const out = exec.tick(makeCtx(pool), buildSignal(), pool, 'broken')
    expect(out.data.some((value) => value !== 0)).toBe(true)
    expect(out.data[3]).toBe(255)
  })

  it('throws decorated node errors in strict mode', () => {
    const pool = new BufferPoolImpl()
    const exec = new GraphExecutor()
    const broken = makeGenerator('broken', 0)
    broken.render = () => {
      throw new Error('bad shader')
    }
    exec.load(
      { nodes: [{ id: 'broken', type: 'generator', impl: 'test', config: {} }], edges: [], outputs: { terminal: 'broken' } },
      new Map([['broken', broken]]),
    )
    expect(() =>
      exec.tick(makeCtx(pool), buildSignal(), pool, 'broken', undefined, { strictErrors: true }),
    ).toThrow("Node 'broken' failed: bad shader")
  })

  it('rejects invalid output targets during graph validation', () => {
    expect(() =>
      validateSceneGraph(
        {
          nodes: [{ id: 'sig', type: 'signal', impl: 'test', config: {} }],
          edges: [],
          outputs: { terminal: 'sig' },
        },
        new Map([['sig', {
          type: 'signal',
          id: 'sig',
          outputs: ['value'],
          config: {},
          init: () => {},
          tick: () => ({ value: 1 }),
          destroy: () => {},
        }]]),
      ),
    ).toThrow("cannot target signal node")
  })
})
