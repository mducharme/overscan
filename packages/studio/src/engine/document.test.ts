import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BufferPoolBrowser } from '@overscan/core/browser'
import type { NodeContext } from '@overscan/types'
import type { Bridge } from './bridge'
import { loadDocument } from './document'

const EXAMPLES = join(__dirname, '..', '..', '..', '..', 'examples')

/** Bridge backed by the local file system, like the dev server's. */
const fsBridge: Bridge = {
  async read(filePath) {
    const [text, info] = await Promise.all([readFile(filePath, 'utf8'), stat(filePath)])
    return { filePath, text, mtimeMs: info.mtimeMs }
  },
  save: () => Promise.reject(new Error('read-only')),
  async stat(filePath) {
    return (await stat(filePath)).mtimeMs
  },
  async readBinary(filePath) {
    return new Uint8Array(await readFile(filePath))
  },
  mediaUrl: filePath => filePath,
}

function render(doc: Awaited<ReturnType<typeof loadDocument>>, t: number) {
  const pool = new BufferPoolBrowser()
  const { width, height } = doc.player.resolution
  const ctx: NodeContext = { canvas: null, ctx2d: null, gl: null, pool, width, height }
  doc.player.init(ctx)
  return doc.player.render(pool, ctx, t, 0, 0)
}

describe('loadDocument', () => {
  it('loads a scene as a single-section player', async () => {
    const doc = await loadDocument(fsBridge, join(EXAMPLES, 'generators', 'plasma.scene.json'))
    expect(doc.kind).toBe('scene')
    expect(doc.player.sections).toHaveLength(1)
    expect(doc.player.duration).toBeGreaterThan(0)
    expect(render(doc, 1)?.buffer.data.some(v => v > 0)).toBe(true)
  })

  it('loads every section of a demo, resolving section paths on any platform separator', async () => {
    const doc = await loadDocument(fsBridge, join(EXAMPLES, 'showcase.demo.json'))
    expect(doc.kind).toBe('demo')
    expect(doc.player.sections.length).toBe(16)
    expect(doc.player.duration).toBeGreaterThan(80)
    expect(doc.player.sectionAt(30)?.id).toBeDefined()
    expect(render(doc, 30)?.buffer.data.some(v => v > 0)).toBe(true)
  })

  it('loads shader assets relative to each section, with no asset problems', async () => {
    const doc = await loadDocument(fsBridge, join(EXAMPLES, 'showcase.demo.json'))
    expect(doc.assetProblems).toEqual([])
  })

  it('reports assets that fail to load instead of failing silently', async () => {
    const bridge: Bridge = {
      ...fsBridge,
      async read(filePath) {
        if (filePath.endsWith('.glsl')) throw new Error('missing shader')
        return fsBridge.read(filePath)
      },
    }
    const doc = await loadDocument(bridge, join(EXAMPLES, 'generators', 'raymarcher-monument.scene.json'))
    expect(doc.assetProblems).toEqual([expect.objectContaining({ nodeId: 'rm1', message: 'missing shader' })])
  })
})
