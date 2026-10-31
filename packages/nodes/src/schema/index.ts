import { CLASSIC_SCHEMAS } from './classics.js'
import { COMPOSITOR_SCHEMAS } from './compositors.js'
import { GENERATOR_SCHEMAS_1 } from './generators-1.js'
import { GENERATOR_SCHEMAS_2 } from './generators-2.js'
import { MODIFIER_SCHEMAS } from './modifiers.js'
import { SIGNAL_SCHEMAS } from './signals.js'
import type { NodeSchema } from './types.js'

export type * from './types.js'
export { validateNodeConfig, type ConfigProblem } from './validate.js'

/** Every built-in effect's settings schema, keyed by `impl`. */
export const NODE_SCHEMAS: Readonly<Record<string, NodeSchema>> = Object.fromEntries(
  [...GENERATOR_SCHEMAS_1, ...GENERATOR_SCHEMAS_2, ...CLASSIC_SCHEMAS, ...MODIFIER_SCHEMAS, ...COMPOSITOR_SCHEMAS, ...SIGNAL_SCHEMAS]
    .map(schema => [schema.impl, schema]),
)
