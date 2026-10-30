import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { validate } from './validate.js'

/**
 * Reproduces the exact template that `init` writes so we can validate it
 * without needing to chdir (which vitest workers don't support).
 */
function sceneTemplate(name: string): string {
  return JSON.stringify({
    id:         name,
    title:      name,
    duration:   30,
    bpm:        120,
    rowsPerBeat: 8,
    resolution: { width: 640, height: 360 },
    fps:        30,
    tracks:     [],
    graph: {
      nodes: [
        {
          id:     'plasma1',
          type:   'generator',
          impl:   'plasma',
          config: { speed: 1, scale: 1 },
        },
      ],
      edges:   [],
      outputs: { terminal: 'plasma1', browser: 'plasma1', export: 'plasma1' },
    },
  }, null, 2)
}

describe('init scaffold', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    vi.restoreAllMocks()
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('template passes overscan validate', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'overscan-init-'))
    tempDirs.push(dir)
    const scenePath = join(dir, 'scene.json')
    writeFileSync(scenePath, sceneTemplate('my-demo'))

    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await validate(scenePath)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('valid'))
  })

  it('template has correct structure', () => {
    const raw = sceneTemplate('test-scene')
    const parsed = JSON.parse(raw) as Record<string, unknown>

    expect(parsed['id']).toBe('test-scene')
    expect(parsed['bpm']).toBe(120)
    const graph = parsed['graph'] as { nodes: { impl: string; type: string }[] }
    expect(graph.nodes).toHaveLength(1)
    expect(graph.nodes[0]?.impl).toBe('plasma')
    expect(graph.nodes[0]?.type).toBe('generator')
  })
})
