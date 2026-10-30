import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { listBuiltinImpls } from '../registry.js'
import { COMPOSITOR_SCHEMAS } from './compositors.js'
import { GENERATOR_SCHEMAS_1 } from './generators-1.js'
import { GENERATOR_SCHEMAS_2 } from './generators-2.js'
import { MODIFIER_SCHEMAS } from './modifiers.js'
import { SIGNAL_SCHEMAS } from './signals.js'
import { NODE_SCHEMAS, validateNodeConfig } from './index.js'

const EXAMPLES = join(__dirname, '..', '..', '..', '..', 'examples')

function sceneFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name)
    if (name === 'node_modules' || name === 'dist') return []
    if (statSync(full).isDirectory()) return sceneFiles(full)
    return name.endsWith('.scene.json') ? [full] : []
  })
}

describe('node settings schemas', () => {
  it('covers every registered effect exactly once', () => {
    const all = [...GENERATOR_SCHEMAS_1, ...GENERATOR_SCHEMAS_2, ...MODIFIER_SCHEMAS, ...COMPOSITOR_SCHEMAS, ...SIGNAL_SCHEMAS]
    const impls = all.map(s => s.impl)
    expect(impls.length).toBe(new Set(impls).size)
    expect([...impls].sort()).toEqual([...listBuiltinImpls()].sort())
  })

  it('has defaults that pass its own validation', () => {
    for (const schema of Object.values(NODE_SCHEMAS)) {
      const defaults = Object.fromEntries(
        Object.entries(schema.params).filter(([, p]) => 'default' in p && p.default !== undefined).map(([k, p]) => [k, (p as { default: unknown }).default]),
      )
      expect({ impl: schema.impl, problems: validateNodeConfig(schema, defaults) }).toEqual({ impl: schema.impl, problems: [] })
    }
  })

  it('accepts every example scene config', () => {
    const problems: string[] = []
    for (const file of sceneFiles(EXAMPLES)) {
      const scene = JSON.parse(readFileSync(file, 'utf8')) as { graph: { nodes: { id: string; impl: string; config?: Record<string, unknown> }[] } }
      for (const node of scene.graph.nodes) {
        const schema = NODE_SCHEMAS[node.impl]
        if (!schema) continue
        for (const p of validateNodeConfig(schema, node.config ?? {})) problems.push(`${file.split('examples/')[1]} ${node.id}.${p.key}: ${p.message}`)
      }
    }
    expect(problems).toEqual([])
  })
})
