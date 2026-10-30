import type { NodeSchema, ParamSchema } from './types.js'

export interface ConfigProblem {
  key: string
  message: string
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isAnimatableRef = (v: unknown): boolean =>
  isRecord(v) && (typeof v['track'] === 'string' || (typeof v['node'] === 'string' && typeof v['output'] === 'string'))
const isColorTriple = (v: unknown): boolean =>
  Array.isArray(v) && v.length >= 3 && v.every(c => typeof c === 'number' && Number.isFinite(c))

function checkParam(param: ParamSchema, value: unknown): string | null {
  switch (param.type) {
    case 'number':
      if (typeof value === 'number' && Number.isFinite(value)) return null
      if (param.animatable && isAnimatableRef(value)) return null
      return param.animatable ? 'expected a number or a { track } / { node, output } reference' : 'expected a number'
    case 'integer':
      return typeof value === 'number' && Number.isFinite(value) ? null : 'expected a whole number'
    case 'boolean':
      return typeof value === 'boolean' ? null : 'expected true or false'
    case 'enum':
      if (typeof value !== 'string') return `expected one of ${param.options.join(', ')}`
      return param.open || param.options.includes(value) ? null : `expected one of ${param.options.join(', ')}`
    case 'string':
      return typeof value === 'string' ? null : 'expected a string'
    case 'color':
      if (typeof value !== 'string') return 'expected a hex colour'
      return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) || param.allow?.includes(value) ? null : 'expected a hex colour such as #ff00aa'
    case 'palette':
      return Array.isArray(value) && value.every(isColorTriple) ? null : 'expected a list of [r, g, b] colours'
    case 'vec2':
    case 'vec3': {
      const n = param.type === 'vec2' ? 2 : 3
      return Array.isArray(value) && value.length === n && value.every(c => typeof c === 'number') ? null : `expected ${n} numbers`
    }
    case 'asset':
      return typeof value === 'string' ? null : 'expected a file path or URL'
    case 'json':
      return null
  }
}

/** Problems with a node's config: unknown keys (outside `deprecated`) and values of the wrong type. */
export function validateNodeConfig(schema: NodeSchema, config: Record<string, unknown>): ConfigProblem[] {
  const problems: ConfigProblem[] = []
  for (const [key, value] of Object.entries(config)) {
    const param = schema.params[key]
    if (!param) {
      if (!schema.deprecated?.includes(key)) problems.push({ key, message: `unknown option for ${schema.impl}` })
      continue
    }
    const message = checkParam(param, value)
    if (message) problems.push({ key, message })
  }
  return problems
}
