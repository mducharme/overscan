/**
 * Settings schemas: one per built-in effect, describing every config option. Pure data (browser-safe).
 * They drive the studio inspector, config validation and the generated effects reference.
 */

interface ParamBase {
  /** One sentence, shown as help text. */
  description: string
}

/** A number. `animatable` options also accept `{ track }` or `{ node, output }` references. */
export interface NumberParam extends ParamBase {
  type: 'number'
  default: number
  min?: number
  max?: number
  step?: number
  animatable?: boolean
}

/** A whole number (counts, sizes). Never animatable. */
export interface IntegerParam extends ParamBase {
  type: 'integer'
  default: number
  min?: number
  max?: number
}

export interface BooleanParam extends ParamBase {
  type: 'boolean'
  default: boolean
}

/** One of `options`; with `open: true` any other string is accepted too (e.g. a custom charset). */
export interface EnumParam extends ParamBase {
  type: 'enum'
  options: readonly string[]
  default: string
  open?: boolean
}

export interface StringParam extends ParamBase {
  type: 'string'
  default: string
  multiline?: boolean
}

/** Hex colour string such as '#ff00aa'. `allow` lists extra keywords (e.g. 'transparent', 'auto'). */
export interface ColorParam extends ParamBase {
  type: 'color'
  default: string
  allow?: readonly string[]
}

/** List of [r, g, b] colours (0–255). */
export interface PaletteParam extends ParamBase {
  type: 'palette'
  default: number[][]
}

/** Fixed-length numeric vector, e.g. a camera position. */
export interface VectorParam extends ParamBase {
  type: 'vec2' | 'vec3'
  default: number[]
}

/** Path or URL to a file the node loads (image, text, font, shader). No default. */
export interface AssetParam extends ParamBase {
  type: 'asset'
  kind: 'image' | 'text' | 'font' | 'audio'
}

/** Anything else (structured objects, lists of strings). Validated only as JSON. */
export interface JsonParam extends ParamBase {
  type: 'json'
  default?: unknown
}

export type ParamSchema =
  | NumberParam
  | IntegerParam
  | BooleanParam
  | EnumParam
  | StringParam
  | ColorParam
  | PaletteParam
  | VectorParam
  | AssetParam
  | JsonParam

export interface NodeSchema {
  /** Registry key, e.g. 'plasma'. */
  impl: string
  kind: 'generator' | 'modifier' | 'compositor' | 'signal'
  /** Human name, e.g. 'Plasma'. */
  label: string
  /** One or two sentences on what it draws or does. */
  description: string
  /** Compositor input names (in order); modifiers take a single input. */
  inputs?: readonly string[]
  /** Signal output names. */
  outputs?: readonly string[]
  params: Record<string, ParamSchema>
  /** Keys the node still accepts for compatibility but which do nothing. Not shown in the inspector. */
  deprecated?: readonly string[]
}
