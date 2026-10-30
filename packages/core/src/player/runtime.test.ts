import { describe, expect, it } from 'vitest'
import type { DemoNode, Scene, SceneNode } from '@overscan/types'
import { createDemoRuntimeDocument } from './runtime.js'
import type { AssetManagerOptions } from '../scene/asset-manager.js'

function sceneWithShader(id: string, shaderPath: string): Scene {
  return {
    id,
    title: id,
    duration: 1,
    bpm: 120,
    rowsPerBeat: 8,
    resolution: { width: 8, height: 8 },
    fps: 30,
    tracks: [],
    graph: {
      nodes: [{ id: 'g', type: 'generator', impl: 'stub', config: { shaderPath } }],
      edges: [],
      outputs: { export: 'g' },
    },
  }
}

const stubRegistry = (nodes: SceneNode[]): Map<string, DemoNode> =>
  new Map(nodes.map(node => [node.id, {
    type: 'generator',
    id: node.impl,
    renderers: ['cpu'],
    config: {},
    init() {},
    render() {},
    destroy() {},
  } as DemoNode]))

describe('createDemoRuntimeDocument', () => {
  it('resolves each section\'s relative assets against its own scene file', async () => {
    const loaded: string[] = []
    const fileAssets = (base: string): AssetManagerOptions => ({
      resolveAssetUrl: url => `${base.slice(0, base.lastIndexOf('/'))}/${url}`,
      async loadText(path) {
        loaded.push(path)
        return 'shader'
      },
    })
    await createDemoRuntimeDocument(
      { id: 'd', title: 'd', sections: [{ id: 'a', scene: 'a/one.scene.json' }, { id: 'b', scene: 'b/two.scene.json' }] },
      {
        sinkId: 'export',
        buildRegistry: stubRegistry,
        assetManager: fileAssets('/demo/main.demo.json'),
        sectionAssetManager: scenePath => fileAssets(scenePath),
        async loadSection(raw) {
          const scenePath = `/demo/${raw}`
          return { scene: sceneWithShader(raw, 'fx.glsl'), scenePath }
        },
      },
    )
    expect(loaded.sort()).toEqual(['/demo/a/fx.glsl', '/demo/b/fx.glsl'])
  })
})
