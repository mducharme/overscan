import { describe, expect, it } from 'vitest'
import { formatValue, removeJsonValue, setJsonValue } from './json-edit'

const doc = `{
  "id": "x",
  "graph": {
    "nodes": [
      { "id": "a", "type": "generator", "impl": "plasma", "config": { "speed": 1.4, "scale": 1.6 } },
      {
        "id": "b",
        "config": {
          "radius": 0.28,
          "centerX": { "track": "lens.x" }
        }
      }
    ]
  }
}
`

describe('setJsonValue', () => {
  it('replaces a value in place and touches nothing else', () => {
    const out = setJsonValue(doc, ['graph', 'nodes', 0, 'config', 'speed'], 2)
    expect(out).toBe(doc.replace('"speed": 1.4', '"speed": 2'))
    expect(JSON.parse(out).graph.nodes[0].config.speed).toBe(2)
  })

  it('adds a key inline to a single-line object', () => {
    const out = setJsonValue(doc, ['graph', 'nodes', 0, 'config', 'palette'], [[1, 2, 3]])
    expect(out).toContain('"scale": 1.6, "palette": [[1, 2, 3]] }')
  })

  it('adds a key on its own line to a multi-line object', () => {
    const out = setJsonValue(doc, ['graph', 'nodes', 1, 'config', 'zoom'], 2.2)
    expect(out).toContain('"centerX": { "track": "lens.x" },\n          "zoom": 2.2\n        }')
    expect(JSON.parse(out).graph.nodes[1].config.zoom).toBe(2.2)
  })

  it('replaces a binding with a value and back', () => {
    const unbound = setJsonValue(doc, ['graph', 'nodes', 1, 'config', 'centerX'], 0.5)
    expect(unbound).toContain('"centerX": 0.5\n')
    expect(setJsonValue(unbound, ['graph', 'nodes', 1, 'config', 'centerX'], { track: 'lens.x' })).toBe(doc)
  })

  it('fills an empty object', () => {
    expect(setJsonValue('{ "config": {} }', ['config', 'a'], 1)).toBe('{ "config": { "a": 1 } }')
  })
})

describe('removeJsonValue', () => {
  it('removes first, middle and last properties cleanly', () => {
    expect(removeJsonValue(doc, ['graph', 'nodes', 0, 'config', 'speed'])).toContain('"config": { "scale": 1.6 }')
    expect(removeJsonValue(doc, ['graph', 'nodes', 0, 'config', 'scale'])).toContain('"config": { "speed": 1.4 }')
    const out = removeJsonValue(doc, ['graph', 'nodes', 1, 'config', 'centerX'])
    expect(out).toContain('"radius": 0.28\n        }')
    expect(JSON.parse(out).graph.nodes[1].config).toEqual({ radius: 0.28 })
    expect(removeJsonValue('{ "c": { "a": 1 } }', ['c', 'a'])).toBe('{ "c": {} }')
    expect(removeJsonValue(doc, ['graph', 'nodes', 0, 'config', 'missing'])).toBe(doc)
  })
})

describe('formatValue', () => {
  it('writes compact values and expands long ones', () => {
    expect(formatValue({ track: 'x' })).toBe('{ "track": "x" }')
    const long = formatValue(Array.from({ length: 12 }, (_, i) => [i * 20, i * 10, 255]), '      ')
    expect(long.split('\n')).toHaveLength(14)
    expect(JSON.parse(long)).toHaveLength(12)
  })
})
