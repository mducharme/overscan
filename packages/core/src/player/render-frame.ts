import type { BufferPool, NodeContext, Scene, Signal } from '@overscan/types'
import type {
  GraphExecutor} from '../graph/executor.js';
import {
  type ExecutorProfiler,
  type ExecutorRenderOptions,
} from '../graph/executor.js'
import { buildSignal } from '../signal/builder.js'
import { RocketTimeline } from '../timeline/rocket.js'

export interface ScenePlayer {
  scene: Scene
  timeline: RocketTimeline
  executor: GraphExecutor
  pool: BufferPool
  ctx: NodeContext
  outputNodeId: string
}

export interface RenderedFrame {
  buffer: ReturnType<BufferPool['acquire']>
  signal: Signal
}

export type RenderFrameOptions = ExecutorRenderOptions

export function renderSceneFrame(
  player: ScenePlayer,
  t: number,
  frame: number,
  dt: number,
  profiler?: ExecutorProfiler,
  options?: RenderFrameOptions,
): RenderedFrame {
  const row = RocketTimeline.timeToRow(t, player.scene.bpm, player.scene.rowsPerBeat)
  const tracks = player.timeline.resolve(row)
  const signal = buildSignal({
    t,
    frame,
    dt,
    bpm: player.scene.bpm,
    beat: row / player.scene.rowsPerBeat,
    tracks,
  })
  const buffer = player.executor.tick(player.ctx, signal, player.pool, player.outputNodeId, profiler, options)
  return { buffer, signal }
}
