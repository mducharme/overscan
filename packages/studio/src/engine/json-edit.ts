/**
 * Format-preserving JSON edits: change or remove one value in a JSON document's text and leave every
 * other byte (indentation, inline arrays, key order) as the author wrote it.
 */

export type JsonPath = readonly (string | number)[]

interface Span {
  start: number
  end: number
}

type JsonNode =
  | (Span & { type: 'object'; props: { key: string; keySpan: Span; value: JsonNode }[] })
  | (Span & { type: 'array'; items: JsonNode[] })
  | (Span & { type: 'scalar' })

function parse(text: string): JsonNode {
  let i = 0
  const ws = (): void => { while (i < text.length && /\s/.test(text[i]!)) i++ }
  const fail = (what: string): never => { throw new SyntaxError(`JSON: expected ${what} at offset ${i}`) }
  const string = (): Span => {
    const start = i
    if (text[i] !== '"') fail('a string')
    i++
    while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1
    if (i >= text.length) fail('a closing quote')
    i++
    return { start, end: i }
  }
  const value = (): JsonNode => {
    ws()
    const start = i
    const c = text[i]
    if (c === '{') {
      i++
      const props: { key: string; keySpan: Span; value: JsonNode }[] = []
      ws()
      if (text[i] === '}') { i++; return { type: 'object', start, end: i, props } }
      for (;;) {
        ws()
        const keySpan = string()
        const key = JSON.parse(text.slice(keySpan.start, keySpan.end)) as string
        ws()
        if (text[i] !== ':') fail("':'")
        i++
        props.push({ key, keySpan, value: value() })
        ws()
        if (text[i] === ',') { i++; continue }
        if (text[i] === '}') { i++; return { type: 'object', start, end: i, props } }
        fail("',' or '}'")
      }
    }
    if (c === '[') {
      i++
      const items: JsonNode[] = []
      ws()
      if (text[i] === ']') { i++; return { type: 'array', start, end: i, items } }
      for (;;) {
        items.push(value())
        ws()
        if (text[i] === ',') { i++; continue }
        if (text[i] === ']') { i++; return { type: 'array', start, end: i, items } }
        fail("',' or ']'")
      }
    }
    if (c === '"') return { type: 'scalar', ...string() }
    const m = /^(-?\d+(\.\d+)?([eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i, i + 40))
    if (!m) fail('a value')
    i += m![0].length
    return { type: 'scalar', start, end: i }
  }
  const root = value()
  ws()
  if (i !== text.length) fail('end of input')
  return root
}

function find(root: JsonNode, path: JsonPath): JsonNode | undefined {
  let node: JsonNode | undefined = root
  for (const part of path) {
    if (!node) return undefined
    if (node.type === 'object' && typeof part === 'string') node = node.props.find(p => p.key === part)?.value
    else if (node.type === 'array' && typeof part === 'number') node = node.items[part]
    else return undefined
  }
  return node
}

/**
 * Compact serialisation in the examples' style: `{ "a": 1, "b": [1, 2] }`. Long values (over `width`
 * characters) are expanded one entry per line at `indent`.
 */
export function formatValue(value: unknown, indent = '', unit = '  ', width = 100): string {
  const inline = (v: unknown): string => {
    if (Array.isArray(v)) return `[${v.map(inline).join(', ')}]`
    if (v && typeof v === 'object') {
      const entries = Object.entries(v as Record<string, unknown>)
      return entries.length ? `{ ${entries.map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(', ')} }` : '{}'
    }
    // JSON.stringify returns undefined for undefined values, despite its declared type.
    return v === undefined ? 'null' : JSON.stringify(v)
  }
  const flat = inline(value)
  if (flat.length + indent.length <= width || value === null || typeof value !== 'object') return flat
  const inner = indent + unit
  if (Array.isArray(value)) return `[\n${value.map(v => inner + formatValue(v, inner, unit, width)).join(',\n')}\n${indent}]`
  const entries = Object.entries(value as Record<string, unknown>)
  return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${formatValue(v, inner, unit, width)}`).join(',\n')}\n${indent}}`
}

const lineStart = (text: string, offset: number): number => text.lastIndexOf('\n', offset - 1) + 1
const indentAt = (text: string, offset: number): string => /^[ \t]*/.exec(text.slice(lineStart(text, offset)))![0]

/** Sets the value at `path`, adding the final key to its object if missing. Parent objects must exist. */
export function setJsonValue(text: string, path: JsonPath, value: unknown): string {
  const root = parse(text)
  const existing = find(root, path)
  if (existing) {
    const formatted = formatValue(value, indentAt(text, existing.start))
    return text.slice(0, existing.start) + formatted + text.slice(existing.end)
  }
  const key = path.at(-1)
  const parent = find(root, path.slice(0, -1))
  if (typeof key !== 'string' || parent?.type !== 'object') throw new Error(`No object at ${path.slice(0, -1).join('.')}`)
  const last = parent.props.at(-1)
  const multiline = text.slice(parent.start, parent.end).includes('\n')
  if (!last) {
    const indent = indentAt(text, parent.start)
    const entry = `${JSON.stringify(key)}: ${formatValue(value, `${indent}  `)}`
    return text.slice(0, parent.start) + (multiline ? `{\n${indent}  ${entry}\n${indent}}` : `{ ${entry} }`) + text.slice(parent.end)
  }
  if (multiline && text.slice(last.value.end, parent.end).includes('\n')) {
    const indent = indentAt(text, last.keySpan.start)
    const entry = `,\n${indent}${JSON.stringify(key)}: ${formatValue(value, indent)}`
    return text.slice(0, last.value.end) + entry + text.slice(last.value.end)
  }
  return `${text.slice(0, last.value.end)}, ${JSON.stringify(key)}: ${formatValue(value)}${text.slice(last.value.end)}`
}

/**
 * Inserts `value` into the array at `path` before index `index` (default: append). Items go on their own
 * line when the array is multi-line, and stay on one line when their neighbours do.
 */
export function insertJsonValue(text: string, path: JsonPath, value: unknown, index?: number): string {
  const array = find(parse(text), path)
  if (array?.type !== 'array') throw new Error(`No array at ${path.join('.')}`)
  const at = Math.min(index ?? array.items.length, array.items.length)
  const multiline = text.slice(array.start, array.end).includes('\n')
  const neighbour = array.items[at] ?? array.items[at - 1]
  // Match the neighbours: one-line items stay one line however long, expanded ones expand.
  const width = neighbour && !text.slice(neighbour.start, neighbour.end).includes('\n') ? Infinity : 100
  if (!neighbour) {
    const indent = indentAt(text, array.start)
    const item = formatValue(value, `${indent}  `, '  ', width)
    return text.slice(0, array.start) + (multiline ? `[\n${indent}  ${item}\n${indent}]` : `[${item}]`) + text.slice(array.end)
  }
  const separate = multiline && text.slice(array.start, neighbour.start).includes('\n')
  const indent = separate ? indentAt(text, neighbour.start) : ''
  const item = formatValue(value, indent, '  ', width)
  const gap = separate ? `,\n${indent}` : ', '
  if (at < array.items.length) return text.slice(0, neighbour.start) + item + gap + text.slice(neighbour.start)
  return text.slice(0, neighbour.end) + gap + item + text.slice(neighbour.end)
}

/**
 * Removes the value at `path` (an object key or an array index) together with its separating comma.
 * No-op if absent.
 */
export function removeJsonValue(text: string, path: JsonPath): string {
  const root = parse(text)
  const key = path.at(-1)
  const parent = find(root, path.slice(0, -1))
  if (parent?.type === 'array' && typeof key === 'number') {
    const item = parent.items[key]
    if (!item) return text
    const prev = parent.items[key - 1]
    const next = parent.items[key + 1]
    if (next) return text.slice(0, item.start) + text.slice(next.start)
    if (prev) return text.slice(0, prev.end) + text.slice(item.end)
    return `${text.slice(0, parent.start)}[]${text.slice(parent.end)}`
  }
  if (typeof key !== 'string' || parent?.type !== 'object') return text
  const index = parent.props.findIndex(p => p.key === key)
  if (index < 0) return text
  const prop = parent.props[index]!
  const prev = parent.props[index - 1]
  const next = parent.props[index + 1]
  if (next) return text.slice(0, prop.keySpan.start) + text.slice(next.keySpan.start)
  if (prev) return text.slice(0, prev.value.end) + text.slice(prop.value.end)
  // Only property: leave an empty object.
  return `${text.slice(0, parent.start)}{}${text.slice(parent.end)}`
}
