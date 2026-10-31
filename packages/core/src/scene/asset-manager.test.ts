import { describe, expect, it } from 'vitest'
import { createAssetManager } from './asset-manager.js'

describe('SceneAssetManager', () => {
  it('preloads built-in and json-backed image assets from scene config', async () => {
    const manager = createAssetManager({
      resolveAssetUrl(url) {
        return url
      },
      async loadText(path) {
        if (path !== 'terrain.json') throw new Error(`missing ${path}`)
        return JSON.stringify({
          width: 2,
          height: 1,
          data: [0, 0, 0, 255, 255, 200, 50, 255],
        })
      },
    })

    await manager.preloadScene({
      id: 'asset-scene',
      title: 'Assets',
      duration: 1,
      bpm: 120,
      rowsPerBeat: 8,
      resolution: { width: 16, height: 16 },
      fps: 30,
      tracks: [],
      graph: {
        nodes: [
          {
            id: 'roto',
            type: 'generator',
            impl: 'rotozoom',
            config: { textureUrl: 'overscan://checkerboard' },
          },
          {
            id: 'voxel',
            type: 'generator',
            impl: 'voxel-landscape',
            config: { colormap: 'terrain.json' },
          },
        ],
        edges: [],
        outputs: { export: 'roto' },
      },
    })

    expect(manager.getImage('overscan://checkerboard')?.width).toBe(64)
    expect(manager.getImage('terrain.json')?.width).toBe(2)
    expect(manager.getError('terrain.json')).toBeUndefined()
  })

  it('leaves built-in bitmap fonts to the text renderer instead of reporting them missing', async () => {
    const manager = createAssetManager({
      resolveAssetUrl: url => url,
      loadText: () => Promise.reject(new Error('should not load')),
    })
    const scene = {
      id: 's', title: 's', duration: 1, bpm: 120, rowsPerBeat: 8, fps: 30, resolution: { width: 8, height: 8 }, tracks: [],
      graph: { nodes: [{ id: 't', type: 'generator' as const, impl: 'text', config: { font: 'overscan://fonts/Press2P' } }], edges: [], outputs: { terminal: 't' } },
    }
    await manager.preloadScene(scene)
    expect(manager.getError('overscan://fonts/Press2P')).toBeUndefined()
  })
})
