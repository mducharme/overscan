import type {
  DemoNode,
  SceneNode,
  SceneGraph,
  Signal,
  FrameBuffer,
  NodeContext,
  CompositorInputMeta,
  CompositorEdgeTransform,
} from '@overscan/types'
import type { BufferPool } from '@overscan/types'

interface ResolvedEdge {
  fromNode: string
  fromOutput: string
  toNode: string
  toInput: string
  z: number
  transform?: CompositorEdgeTransform | undefined
}

/** Per-node wall time in milliseconds (improvement plan §2.4). */
export interface ExecutorProfiler {
  record(nodeId: string, ms: number): void
}

export interface ExecutorRenderOptions {
  strictErrors?: boolean
}

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  // Browser `process` shims often lack hrtime, though Node's typings declare it.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (typeof process !== 'undefined' && typeof process.hrtime?.bigint === 'function') {
    return Number(process.hrtime.bigint()) / 1e6
  }
  return Date.now()
}

function syncTexture(gl: WebGL2RenderingContext, buffer: FrameBuffer): void {
  if (!buffer.texture) return
  gl.bindTexture(gl.TEXTURE_2D, buffer.texture)
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    buffer.width,
    buffer.height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    buffer.data,
  )
}

function syncCpu(gl: WebGL2RenderingContext, buffer: FrameBuffer): void {
  if (!buffer.fbo) return
  gl.bindFramebuffer(gl.FRAMEBUFFER, buffer.fbo)
  gl.readPixels(0, 0, buffer.width, buffer.height, gl.RGBA, gl.UNSIGNED_BYTE, buffer.data)
}

function likelyGpuRendered(ctx: NodeContext, node: DemoNode, out: FrameBuffer): boolean {
  if (!ctx.gl || !out.texture || !out.fbo) return false
  if (node.type === 'generator') return node.renderers.includes('gpu')
  if (node.type === 'signal') return false
  return typeof node.glsl === 'string'
}

function isNodeActive(sceneNode: { startTime?: number; endTime?: number } | undefined, time: number): boolean {
  if (!sceneNode) return true
  if (typeof sceneNode.startTime === 'number' && time < sceneNode.startTime) return false
  if (typeof sceneNode.endTime === 'number' && time > sceneNode.endTime) return false
  return true
}

export function validateSceneGraph(graph: SceneGraph, registry: Map<string, DemoNode>): void {
  const sceneNodes = new Map<string, SceneNode>()
  for (const node of graph.nodes) {
    if (sceneNodes.has(node.id)) throw new Error(`Duplicate node id '${node.id}' in scene graph`)
    sceneNodes.set(node.id, node)
    if (!registry.has(node.id)) throw new Error(`Node '${node.id}' is missing from the runtime registry`)
  }

  const incomingByNode = new Map<string, Set<string>>()
  for (const edge of graph.edges) {
    const fromNode = registry.get(edge.from.node)
    const toNode = registry.get(edge.to.node)
    if (!fromNode) throw new Error(`Edge references unknown source node '${edge.from.node}'`)
    if (!toNode) throw new Error(`Edge references unknown target node '${edge.to.node}'`)
    if (toNode.type === 'generator' || toNode.type === 'signal') {
      throw new Error(`Node '${edge.to.node}' of type '${toNode.type}' cannot receive graph inputs`)
    }
    if (fromNode.type === 'signal' && !fromNode.outputs.includes(edge.from.output)) {
      throw new Error(`Signal node '${edge.from.node}' has no output '${edge.from.output}'`)
    }
    if (toNode.type === 'compositor' && !toNode.inputs.includes(edge.to.input)) {
      throw new Error(`Compositor node '${edge.to.node}' has no input '${edge.to.input}'`)
    }
    if (toNode.type === 'modifier' && !['color', 'in', 'input'].includes(edge.to.input)) {
      throw new Error(`Modifier node '${edge.to.node}' does not accept input '${edge.to.input}'`)
    }
    let incoming = incomingByNode.get(edge.to.node)
    if (!incoming) {
      incoming = new Set<string>()
      incomingByNode.set(edge.to.node, incoming)
    }
    incoming.add(edge.to.input)
  }

  for (const [sinkId, outputNodeId] of Object.entries(graph.outputs)) {
    const node = registry.get(outputNodeId)
    if (!node) throw new Error(`Output sink '${sinkId}' targets unknown node '${outputNodeId}'`)
    if (node.type === 'signal') throw new Error(`Output sink '${sinkId}' cannot target signal node '${outputNodeId}'`)
  }

  for (const [nodeId, node] of registry.entries()) {
    const incoming = incomingByNode.get(nodeId) ?? new Set<string>()
    if (node.type === 'modifier' && incoming.size === 0) {
      throw new Error(`Modifier node '${nodeId}' is missing its input connection`)
    }
    if (node.type === 'compositor') {
      for (const requiredInput of node.inputs.filter(input => input !== 'mask')) {
        if (!incoming.has(requiredInput)) {
          throw new Error(`Compositor node '${nodeId}' is missing required input '${requiredInput}'`)
        }
      }
    }
  }
}

export class GraphExecutor {
  private nodes = new Map<string, DemoNode>()
  private sceneNodes = new Map<string, SceneNode>()
  private edgeList: ResolvedEdge[] = []
  private order: string[] = []
  private reportedErrors = new Map<string, string>()

  load(graph: SceneGraph, registry: Map<string, DemoNode>): void {
    this.nodes = new Map(registry)
    this.sceneNodes = new Map(graph.nodes.map(node => [node.id, node]))
    this.reportedErrors.clear()
    validateSceneGraph(graph, registry)
    this.edgeList = graph.edges.map((e) => {
      const r: ResolvedEdge = {
        fromNode:   e.from.node,
        fromOutput: e.from.output,
        toNode:     e.to.node,
        toInput:    e.to.input,
        z:          e.z ?? 0,
      }
      if (e.transform !== undefined) r.transform = e.transform
      return r
    })
    this.order = this.topoSort(graph)
  }

  init(ctx: NodeContext): void {
    for (const id of this.order) {
      const node = this.nodes.get(id)
      if (node) node.init(ctx)
    }
  }

  tick(
    ctx: NodeContext,
    signal: Signal,
    pool: BufferPool,
    outputNodeId: string,
    profiler?: ExecutorProfiler,
    options?: ExecutorRenderOptions,
  ): FrameBuffer {
    const mutSources: Record<string, number> = {}
    const strictErrors = options?.strictErrors ?? false
    for (const id of this.order) {
      const node = this.nodes.get(id)
      const sceneNode = this.sceneNodes.get(id)
      if (node?.type === 'signal') {
        const t0 = profiler ? nowMs() : 0
        let out: Record<string, number>
        if (!isNodeActive(sceneNode, signal.t)) {
          out = Object.fromEntries(node.outputs.map((name) => [name, 0]))
        } else {
          try {
            out = node.tick(signal)
          } catch (error) {
            if (strictErrors) throw decorateNodeError(id, error)
            this.reportNodeError(id, error)
            out = Object.fromEntries(node.outputs.map((name) => [name, 0]))
          }
        }
        if (profiler) profiler.record(id, nowMs() - t0)
        for (const [k, v] of Object.entries(out)) {
          mutSources[`${id}.${k}`] = v
        }
      }
    }
    ;(signal as { sources: Record<string, number> }).sources = mutSources

    const buffers = new Map<string, FrameBuffer>()

    for (const id of this.order) {
      const node = this.nodes.get(id)
      if (!node || node.type === 'signal') continue

      const incoming = this.edgeList.filter((e) => e.toNode === id).sort((a, b) => a.z - b.z)
      const inputs: Record<string, FrameBuffer> = {}
      const inputMeta: Record<string, CompositorInputMeta> = {}

      for (const edge of incoming) {
        const src = buffers.get(edge.fromNode)
        if (src) {
          pool.retain(src)
          inputs[edge.toInput] = src
          if (edge.transform) inputMeta[edge.toInput] = { transform: edge.transform }
        }
      }

      const t0 = profiler ? nowMs() : 0
      const size = this.resolveNodeSize(id, node, inputs, ctx)
      const out = pool.acquire(size.width, size.height)
      buffers.set(id, out)

      if (!isNodeActive(this.sceneNodes.get(id), signal.t)) {
        if (profiler) profiler.record(id, nowMs() - t0)
        for (const buf of Object.values(inputs)) {
          pool.release(buf)
        }
        continue
      }

      try {
        if (node.type === 'generator') {
          node.render(this.makeNodeContext(ctx, out.width, out.height), out, signal)
        } else if (node.type === 'modifier') {
          const input =
            inputs['color'] ?? inputs['in'] ?? inputs['input'] ?? Object.values(inputs)[0]
          if (input) node.apply(this.makeNodeContext(ctx, out.width, out.height), input, out, signal)
        } else {
          node.compose(ctx, inputs, out, signal, inputMeta)
        }
      } catch (error) {
        if (strictErrors) throw decorateNodeError(id, error)
        this.reportNodeError(id, error)
        fillErrorPlaceholder(out, id)
      }

      if (ctx.gl && out.fbo && likelyGpuRendered(ctx, node, out)) {
        syncCpu(ctx.gl, out)
      } else if (ctx.gl && out.texture && !likelyGpuRendered(ctx, node, out)) {
        syncTexture(ctx.gl, out)
      }

      if (profiler) profiler.record(id, nowMs() - t0)

      for (const buf of Object.values(inputs)) {
        pool.release(buf)
      }
    }

    const result = buffers.get(outputNodeId)
    if (!result) throw new Error(`Output node '${outputNodeId}' not found in graph`)
    return result
  }

  destroy(): void {
    for (const node of this.nodes.values()) node.destroy()
  }

  private reportNodeError(nodeId: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    if (this.reportedErrors.get(nodeId) === message) return
    this.reportedErrors.set(nodeId, message)
    console.error(`[demo] node '${nodeId}' failed: ${message}`)
  }

  private resolveNodeSize(
    id: string,
    node: DemoNode,
    inputs: Record<string, FrameBuffer>,
    ctx: NodeContext,
  ): { width: number; height: number } {
    if (node.type === 'generator') {
      const sceneNode = this.sceneNodes.get(id)
      const width = sceneNode?.resolution?.width ?? ctx.width
      const height = sceneNode?.resolution?.height ?? ctx.height
      return {
        width: Math.max(1, Math.round(width)),
        height: Math.max(1, Math.round(height)),
      }
    }
    if (node.type === 'modifier') {
      const input = inputs['color'] ?? inputs['in'] ?? inputs['input'] ?? Object.values(inputs)[0]
      if (input) return { width: input.width, height: input.height }
    }
    return { width: ctx.width, height: ctx.height }
  }

  private makeNodeContext(ctx: NodeContext, width: number, height: number): NodeContext {
    return {
      ...ctx,
      width,
      height,
    }
  }

  private topoSort(graph: SceneGraph): string[] {
    const nodeIds = graph.nodes.map((n) => n.id)
    const inDegree = new Map<string, number>(nodeIds.map((id) => [id, 0]))

    for (const edge of graph.edges) {
      inDegree.set(edge.to.node, (inDegree.get(edge.to.node) ?? 0) + 1)
    }

    const queue = nodeIds.filter((id) => (inDegree.get(id) ?? 0) === 0)
    const result: string[] = []

    while (queue.length > 0) {
      const id = queue.shift()!
      result.push(id)
      for (const edge of graph.edges) {
        if (edge.from.node !== id) continue
        const deg = (inDegree.get(edge.to.node) ?? 1) - 1
        inDegree.set(edge.to.node, deg)
        if (deg === 0) queue.push(edge.to.node)
      }
    }

    if (result.length !== nodeIds.length) {
      throw new Error('Scene graph contains a cycle')
    }
    return result
  }
}

function decorateNodeError(nodeId: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  return new Error(`Node '${nodeId}' failed: ${message}`)
}

function fillErrorPlaceholder(out: FrameBuffer, nodeId: string): void {
  const hash = Array.from(nodeId).reduce((sum, ch) => ((sum * 33) ^ ch.charCodeAt(0)) >>> 0, 5381)
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const i = (y * out.width + x) * 4
      const checker = ((x >> 3) + (y >> 3)) & 1
      const cross = x === y || x === out.width - y - 1
      out.data[i] = cross ? 255 : checker ? 255 : 60
      out.data[i + 1] = checker ? 32 : 0
      out.data[i + 2] = checker ? 160 : 0
      out.data[i + 3] = 255
    }
  }
  if (out.width > 0 && out.height > 0) {
    out.data[0] = hash & 0xff
    out.data[1] = (hash >> 8) & 0xff
    out.data[2] = (hash >> 16) & 0xff
  }
}
