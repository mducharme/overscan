import type { DemoNode, SceneNode } from '@overscan/types'

export type NodeFactory = (config: Record<string, unknown>) => DemoNode

export function buildBuiltinRegistryFromFactories(
  sceneNodes: SceneNode[],
  factories: Record<string, NodeFactory>,
): Map<string, DemoNode> {
  const registry = new Map<string, DemoNode>()
  const knownImpls = Object.keys(factories).sort()
  for (const node of sceneNodes) {
    const factory = factories[node.impl]
    if (!factory) {
      throw new Error(
        `Unknown node impl '${node.impl}' on node '${node.id}'. Known: ${knownImpls.join(', ')}`,
      )
    }
    registry.set(node.id, factory(node.config as Record<string, unknown>))
  }
  return registry
}

export function isKnownBuiltinImplFromFactories(
  impl: string,
  factories: Record<string, NodeFactory>,
): boolean {
  return impl in factories
}
