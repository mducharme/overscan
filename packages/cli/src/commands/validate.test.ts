import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { validate } from './validate.js'

function writeScene(dir: string, impl: string): string {
  const path = join(dir, 'scene.json')
  writeFileSync(path, JSON.stringify({
    id: 'test-scene',
    title: 'Test Scene',
    duration: 1,
    bpm: 120,
    rowsPerBeat: 8,
    resolution: { width: 16, height: 16 },
    fps: 30,
    tracks: [],
    graph: {
      nodes: [{ id: 'n1', type: 'generator', impl, config: {} }],
      edges: [],
      outputs: { terminal: 'n1' },
    },
  }))
  return path
}

function writeSceneJson(dir: string, name: string, value: unknown): string {
  const path = join(dir, name)
  writeFileSync(path, JSON.stringify(value))
  return path
}

describe('validate command', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    vi.restoreAllMocks()
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('accepts a known built-in impl', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'overscan-validate-'))
    tempDirs.push(dir)
    const path = writeScene(dir, 'plasma')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await validate(path)

    expect(log).toHaveBeenCalledWith(expect.stringContaining('valid'))
  })

  it('exits non-zero for an unknown impl', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'overscan-validate-'))
    tempDirs.push(dir)
    const path = writeScene(dir, 'definitely-not-real')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code ?? 0}`)
    }) as never)

    await expect(validate(path)).rejects.toThrow('exit:1')
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Unknown node impl'))
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('exits non-zero for invalid graph wiring', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'overscan-validate-'))
    tempDirs.push(dir)
    const path = writeSceneJson(dir, 'scene.json', {
      id: 'bad-scene',
      title: 'Bad Scene',
      duration: 1,
      bpm: 120,
      rowsPerBeat: 8,
      resolution: { width: 16, height: 16 },
      fps: 30,
      tracks: [],
      graph: {
        nodes: [
          { id: 'base', type: 'generator', impl: 'plasma', config: {} },
          { id: 'mix', type: 'compositor', impl: 'screen-blend', config: {} },
        ],
        edges: [
          { from: { node: 'base', output: 'color' }, to: { node: 'mix', input: 'base' } },
        ],
        outputs: { terminal: 'mix' },
      },
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code ?? 0}`)
    }) as never)

    await expect(validate(path)).rejects.toThrow('exit:1')
    expect(error).toHaveBeenCalledWith(expect.stringContaining("missing required input 'overlay'"))
    expect(exit).toHaveBeenCalledWith(1)
  })
})
