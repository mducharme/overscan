import { setTimeout as delay } from 'node:timers/promises'
import type { BufferPool, ClockOptions, NodeContext, Scene, Sink } from '@overscan/types'
import {
  createNodeTimeSource,
  ExecutorProfiler,
  GraphExecutor,
  PlaybackClock,
  renderSceneFrame,
  RocketTimeline,
} from '@overscan/core'

export interface RenderLoopOptions {
  scene: Scene
  pool: BufferPool
  timeline: RocketTimeline
  executor: GraphExecutor
  ctx: NodeContext
  sink: Sink
  outputNodeId: string
  maxFrames?: number
  checkAbort?: () => boolean
  clock?: ClockOptions
  /**
   * When true: timeline is `t = frame / fps` (no wall-clock pacing), so export always reaches `maxFrames`
   * even if sinks are slow. With infinite `maxFrames`, still stops at `scene.duration`.
   */
  syntheticTimeline?: boolean
  /** Log rolling average node times every N frames (improvement plan §2.4). */
  profileEvery?: number
  strictErrors?: boolean
  consumeControl?: () => RenderLoopControl | undefined
  onClockChange?: (state: { time: number; playing: boolean; rate: number }) => Promise<void> | void
}

export interface RenderLoopResult {
  framesRendered: number
  aborted: boolean
}

export type RenderLoopControl =
  | { type: 'seek'; delta: number }
  | { type: 'pause-toggle' }
  | { type: 'rate'; factor: number }

export async function renderLoop(opts: RenderLoopOptions): Promise<RenderLoopResult> {
  const {
    scene,
    pool,
    timeline,
    executor,
    ctx,
    sink,
    outputNodeId,
    maxFrames = Infinity,
    checkAbort,
    clock,
    syntheticTimeline = false,
    profileEvery,
    strictErrors,
    consumeControl,
    onClockChange,
  } = opts

  const timeSource = createNodeTimeSource()
  const playbackClock = new PlaybackClock(timeSource, clock)
  const frameSec = 1 / scene.fps
  const frameMs = frameSec * 1000
  let nextFrameMs = timeSource.nowMs() + frameMs
  let frame           = 0
  let framesRendered  = 0
  let abortedByUser   = false
  let prevT = syntheticTimeline ? 0 : playbackClock.currentTime()

  const profileBuckets = new Map<string, number[]>()
  let profiler: ExecutorProfiler | undefined
  if (profileEvery !== undefined && profileEvery > 0) {
    profiler = {
      record(nodeId: string, ms: number): void {
        let b = profileBuckets.get(nodeId)
        if (!b) {
          b = []
          profileBuckets.set(nodeId, b)
        }
        b.push(ms)
      },
    }
  }

  while (frame < maxFrames) {
    if (checkAbort?.()) {
      abortedByUser = true
      break
    }

    if (!syntheticTimeline) {
      const control = consumeControl?.()
      if (control) {
        switch (control.type) {
          case 'seek': {
            const target = Math.max(0, Math.min(scene.duration > 0 ? scene.duration : Number.POSITIVE_INFINITY, playbackClock.currentTime() + control.delta))
            playbackClock.seek(target)
            prevT = target
            nextFrameMs = timeSource.nowMs() + frameMs
            await onClockChange?.({ time: target, playing: !playbackClock.isPaused(), rate: playbackClock.getRate() })
            break
          }
          case 'pause-toggle':
            if (playbackClock.isPaused()) playbackClock.play()
            else playbackClock.pause()
            nextFrameMs = timeSource.nowMs() + frameMs
            await onClockChange?.({
              time: playbackClock.currentTime(),
              playing: !playbackClock.isPaused(),
              rate: playbackClock.getRate(),
            })
            break
          case 'rate': {
            playbackClock.setRate(Math.max(0, Math.min(8, playbackClock.getRate() * control.factor)))
            nextFrameMs = timeSource.nowMs() + frameMs
            await onClockChange?.({
              time: playbackClock.currentTime(),
              playing: !playbackClock.isPaused(),
              rate: playbackClock.getRate(),
            })
            break
          }
        }
      }

      let nowMs = timeSource.nowMs()
      while (nowMs > nextFrameMs + frameMs) {
        nextFrameMs += frameMs
      }
      const waitMs = nextFrameMs - nowMs
      if (waitMs > 0) {
        await delay(waitMs)
        nowMs = timeSource.nowMs()
      }
      nextFrameMs += frameMs
    }

    const t = syntheticTimeline ? frame * frameSec : playbackClock.currentTime()
    await onClockChange?.({
      time: t,
      playing: syntheticTimeline ? true : !playbackClock.isPaused(),
      rate: syntheticTimeline ? 1 : playbackClock.getRate(),
    })
    const dt = frame === 0 ? 0 : (syntheticTimeline ? frameSec : Math.max(0, t - prevT) || frameSec)
    const { buffer: outBuf, signal } = renderSceneFrame({
      scene,
      pool,
      timeline,
      executor,
      ctx,
      outputNodeId,
    }, t, frame, dt, profiler, strictErrors ? { strictErrors: true } : undefined)
    await sink.write(outBuf, frame, signal)
    pool.release(outBuf)
    framesRendered++
    prevT = t

    if (
      profileEvery &&
      framesRendered % profileEvery === 0 &&
      profileBuckets.size > 0
    ) {
      const parts: string[] = []
      for (const [id, arr] of [...profileBuckets.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        const sum = arr.reduce((s, x) => s + x, 0)
        parts.push(`${id}=${(sum / arr.length).toFixed(2)}ms`)
      }
      console.error(`[demo] profile avg over ${profileEvery}f: ${parts.join(' ')}`)
      profileBuckets.clear()
    }

    if (syntheticTimeline) {
      const finiteCap = Number.isFinite(maxFrames)
      if (!finiteCap && scene.duration > 0 && t >= scene.duration) break
    } else if (scene.duration > 0 && t >= scene.duration) {
      break
    }
    frame++
  }

  return { framesRendered, aborted: abortedByUser }
}
