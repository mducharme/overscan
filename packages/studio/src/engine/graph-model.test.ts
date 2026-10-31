import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Scene } from '@overscan/types'
import { NODE_SCHEMAS, validateNodeConfig } from '@overscan/nodes/browser'
import { parseSceneJson } from '@overscan/core/browser'
import { bindingOf, buildGraphModel, configBindings, NODE_WIDTH, OUTPUT_NODE_ID } from './graph-model'

const EXAMPLES = join(__dirname, '../../../../examples')
const load = (file: string): Scene => parseSceneJson(readFileSync(join(EXAMPLES, file), 'utf8'))

describe('bindings', () => {
  it('recognises track and node references, nested in vectors', () => {
    expect(bindingOf({ track: 'a' })).toEqual({ kind: 'track', track: 'a' })
    expect(bindingOf({ node: 'lfo', output: 'value' })).toEqual({ kind: 'node', node: 'lfo', output: 'value' })
    expect(bindingOf(3)).toBeNull()
    expect(configBindings({ x: 1, pos: [0, { track: 'cam.y' }, 2], deep: { k: { node: 'n', output: 'o' } } })).toEqual([
      { path: 'pos[1]', binding: { kind: 'track', track: 'cam.y' } },
      { path: 'deep.k', binding: { kind: 'node', node: 'n', output: 'o' } },
    ])
  })
})

describe('buildGraphModel', () => {
  it('lays a chain out top to bottom and ends at the output node', () => {
    const model = buildGraphModel(load('advanced/plasma-lens.scene.json'), NODE_SCHEMAS, validateNodeConfig)
    const y = Object.fromEntries(model.nodes.map(n => [n.id, n.y]))
    expect(y.plasma).toBeLessThan(y.lens!)
    expect(y.lens).toBeLessThan(y[OUTPUT_NODE_ID]!)
    expect(model.nodes.find(n => n.id === 'lens')?.tracks).toEqual(['lens.x', 'lens.y'])
    expect(model.edges.map(e => e.kind).sort()).toEqual(['image', 'output'])
    expect(model.nodes.every(n => n.problems.length === 0)).toBe(true)
  })

  it('draws node-output bindings as edges and places the source first', () => {
    const scene = load('signals/audio-analyser.scene.json')
    const model = buildGraphModel(scene, NODE_SCHEMAS, validateNodeConfig)
    const binding = model.edges.find(e => e.kind === 'binding')
    expect(binding?.source).toBe('audio1')
    const y = Object.fromEntries(model.nodes.map(n => [n.id, n.y]))
    expect(y.audio1).toBeLessThan(y[binding!.target]!)
  })

  it('keeps nodes in a layer from overlapping and reports config problems', () => {
    const scene = load('advanced/plasma-lens.scene.json')
    scene.graph.nodes[0]!.config = { ...scene.graph.nodes[0]!.config, speed: 'fast' }
    const model = buildGraphModel(scene, NODE_SCHEMAS, validateNodeConfig)
    expect(model.nodes.find(n => n.id === 'plasma')?.problems.length).toBeGreaterThan(0)
    for (const a of model.nodes) {
      for (const b of model.nodes) {
        if (a === b || a.y !== b.y) continue
        expect(a.x + NODE_WIDTH <= b.x || b.x + NODE_WIDTH <= a.x).toBe(true)
      }
    }
  })
})

describe('layout spacing', () => {
  it('puts the output node directly below the last node, with no empty layer', () => {
    const model = buildGraphModel(load('showcase/01-boot.scene.json'), NODE_SCHEMAS, validateNodeConfig)
    const ys = [...new Set(model.nodes.map(n => n.y))].sort((a, b) => a - b)
    const gaps = ys.slice(1).map((y, i) => y - ys[i]!)
    expect(new Set(gaps).size).toBe(1)
  })
})
