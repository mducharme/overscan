import type { Scene } from '@overscan/types'
import { SceneLoader, validateSceneGraph } from '@overscan/core'
import { buildRegistry } from '../node-registry.js'

function validateSceneOrThrow(scene: Scene, label?: string): void {
  const registry = buildRegistry(scene.graph.nodes)
  validateSceneGraph(scene.graph, registry)
  if (scene.graph.nodes.length === 0) {
    throw new Error(`Scene '${scene.id}' has no nodes`)
  }
  if (Object.keys(scene.graph.outputs).length === 0) {
    throw new Error(`Scene '${scene.id}' has no graph outputs`)
  }
  if (label) {
    console.log(`✓ ${label} — valid (${scene.graph.nodes.length} nodes, ${scene.graph.edges.length} edges)`)
  }
}

export async function validate(path: string): Promise<void> {
  const loader = new SceneLoader()
  try {
    const loaded = await loader.loadAnyFile(path)
    if (loaded.kind === 'scene') {
      validateSceneOrThrow(loaded.scene, loaded.scene.title)
      return
    }

    for (const section of loaded.demo.sections) {
      const scenePath = loader.resolveScenePath(path, section.scene)
      const scene = await loader.loadFile(scenePath)
      validateSceneOrThrow(scene)
    }
    if (loaded.demo.modifiers?.length) buildRegistry(
      loaded.demo.modifiers.map(entry => ({
        id: entry.id,
        type: 'modifier',
        impl: entry.impl,
        config: entry.config,
      })),
    )
    console.log(`✓ ${loaded.demo.title} — valid demo (${loaded.demo.sections.length} sections)`)
  } catch (err) {
    console.error(String(err))
    process.exit(1)
  }
}
