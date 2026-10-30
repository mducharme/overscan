import { readFile } from 'node:fs/promises'
import readline from 'node:readline'
import { setTimeout as delay } from 'node:timers/promises'
import type { Demo, NodeContext, Scene, TerminalMode, TerminalSinkOptions } from '@overscan/types'
import {
  BufferPoolImpl,
  createNodeTimeSource,
  createDemoRuntimeDocument,
  createSceneRuntime,
  type DemoRuntimeDocument,
  PlaybackClock,
  renderDemoRuntimeFrame,
  SceneLoader,
} from '@overscan/core'
import { describeTerminalSession, TerminalSink } from '@overscan/sink-terminal'
import type { GraphExecutor } from '@overscan/core'
import { renderLoop, type RenderLoopControl } from '../render-loop.js'
import { createTerminalAudioController, type TerminalAudioController, type TerminalAudioState } from '../terminal-audio.js'
import { buildRegistry } from '../node-registry.js'
import { fileAssetOptions } from '../file-assets.js'

export interface RunOptions {
  mode?:      TerminalMode
  fpsCap?:    number
  maxFrames?: number
  noDisplay?: boolean
  /** Timeline offset in seconds (improvement plan §2.1). */
  seek?:      number
  /** Playback rate multiplier. */
  rate?:      number
  /** Emit `[demo] profile` every N frames with avg node ms. */
  profileEvery?: number
}

type DemoNavigation = 'previous' | 'next'
type PendingInput = DemoNavigation | RenderLoopControl

function syncCtxToTerminal(ctx: NodeContext, sink: TerminalSink): void {
  const { width, height } = sink.resolution
  ctx.width = width
  ctx.height = height
}

async function runDemo(
  demoPath: string,
  demo: Demo,
  sink: TerminalSink,
  ctx: NodeContext,
  pool: BufferPoolImpl,
  opts: RunOptions,
  onExecutor: (executor: GraphExecutor) => void,
  checkAbort: () => boolean,
  consumeInput?: () => PendingInput | undefined,
): Promise<{ framesRendered: number; aborted: boolean }> {
  const loader = new SceneLoader()
  const runtimeDocument = await loadTerminalDemoRuntime(loader, demoPath, demo)
  const scenes = runtimeDocument.sections
  const baseFps = runtimeDocument.fps
  const audio = createTerminalAudioController()
  try {
    for (const s of scenes) {
      ctx.assets = s.runtime.assets
      s.runtime.executor.init(ctx)
    }
    for (const s of scenes) onExecutor(s.runtime.executor)

    const first = scenes[0]
    if (!first) return { framesRendered: 0, aborted: false }

    const timeSource = createNodeTimeSource()
    const clock = new PlaybackClock(timeSource, {
      ...(opts.seek !== undefined ? { seek: opts.seek } : {}),
      ...(opts.rate !== undefined ? { rate: opts.rate } : {}),
    })
    const loopDemo = demo.loop ?? false
    const frameMs = 1000 / baseFps
    let nextFrameMs = timeSource.nowMs() + frameMs
    let prevT = clock.currentTime()
    let frame = 0
    let framesRendered = 0

    while (true) {
      if (checkAbort()) return { framesRendered, aborted: true }

      const input = consumeInput?.()
      if (input === 'previous' || input === 'next') {
        const navigation = input
        const currentT = clock.currentTime()
        const currentIdx = scenes.findIndex(section => currentT >= section.start && currentT < section.end)
        const fallbackIdx = currentT < scenes[0]!.start ? 0 : scenes.length - 1
        const activeIdx = currentIdx >= 0 ? currentIdx : fallbackIdx
        const targetIdx = navigation === 'previous'
          ? activeIdx > 0
            ? activeIdx - 1
            : loopDemo
              ? scenes.length - 1
              : 0
          : activeIdx < scenes.length - 1
            ? activeIdx + 1
            : loopDemo
              ? 0
              : scenes.length - 1
        const target = scenes[targetIdx]
        if (target) {
          clock.seek(target.start)
          prevT = target.start
          nextFrameMs = timeSource.nowMs() + frameMs
          await syncDemoAudio(audio, loader, demoPath, demo, scenes, target.start, !clock.isPaused(), clock.getRate())
        }
      } else if (input) {
        switch (input.type) {
          case 'pause-toggle':
            if (clock.isPaused()) clock.play()
            else clock.pause()
            nextFrameMs = timeSource.nowMs() + frameMs
            await syncDemoAudio(audio, loader, demoPath, demo, scenes, clock.currentTime(), !clock.isPaused(), clock.getRate())
            break
          case 'seek': {
            const target = Math.max(0, Math.min(scenes[scenes.length - 1]!.end, clock.currentTime() + input.delta))
            clock.seek(target)
            prevT = target
            nextFrameMs = timeSource.nowMs() + frameMs
            await syncDemoAudio(audio, loader, demoPath, demo, scenes, target, !clock.isPaused(), clock.getRate())
            break
          }
          case 'rate':
            clock.setRate(Math.max(0, Math.min(8, clock.getRate() * input.factor)))
            nextFrameMs = timeSource.nowMs() + frameMs
            await syncDemoAudio(audio, loader, demoPath, demo, scenes, clock.currentTime(), !clock.isPaused(), clock.getRate())
            break
        }
      }

      let nowMs = timeSource.nowMs()
      while (nowMs > nextFrameMs + frameMs) nextFrameMs += frameMs
      const waitMs = nextFrameMs - nowMs
      if (waitMs > 0) {
        await delay(waitMs)
        nowMs = timeSource.nowMs()
      }
      nextFrameMs += frameMs

      let t = clock.currentTime()
      if (loopDemo && t >= scenes[scenes.length - 1]!.end) {
        clock.seek(0)
        t = clock.currentTime()
        prevT = t
        await syncDemoAudio(audio, loader, demoPath, demo, scenes, t, !clock.isPaused(), clock.getRate())
      }
      if (!loopDemo && t >= scenes[scenes.length - 1]!.end) break

      const dt = frame === 0 ? 0 : Math.max(0, t - prevT) || (1 / baseFps)
      await syncDemoAudio(audio, loader, demoPath, demo, scenes, t, !clock.isPaused(), clock.getRate())
      const rendered = renderDemoRuntimeFrame(runtimeDocument, { pool, ctx, t, frame, dt })
      if (!rendered) break
      const outBuf = rendered.buffer
      const signal = rendered.signal

      await sink.write(outBuf, frame, signal)
      pool.release(outBuf)
      frame++
      framesRendered++
      prevT = t

      if (opts.maxFrames !== undefined && framesRendered >= opts.maxFrames) break
    }

    return { framesRendered, aborted: false }
  } finally {
    await audio?.dispose()
  }
}

export async function run(scenePath: string, opts: RunOptions = {}): Promise<void> {
  const loader = new SceneLoader()
  const loaded = await loader.loadAnyFile(scenePath)
  const audio = loaded.kind === 'scene' ? createTerminalAudioController() : null

  const sinkOpts: TerminalSinkOptions = {
    noDisplay:  opts.noDisplay ?? false,
    fullscreen: true,
  }
  if (opts.mode !== undefined) sinkOpts.mode = opts.mode
  if (opts.fpsCap !== undefined) sinkOpts.fpsCap = opts.fpsCap
  const sink = new TerminalSink(sinkOpts)

  const pool     = new BufferPoolImpl()

  const ctx: NodeContext = {
    canvas: null, ctx2d: null, gl: null,
    pool, width: 1, height: 1,
  }

  const resizeExecutors: GraphExecutor[] = []
  syncCtxToTerminal(ctx, sink)
  sink.setOnResize(() => {
    syncCtxToTerminal(ctx, sink)
    for (const executor of resizeExecutors) executor.init(ctx)
  })

  const initScene = loaded.kind === 'scene'
    ? loaded.scene
    : await loader.loadFile(loader.resolveScenePath(scenePath, loaded.demo.sections[0]!.scene))
  await sink.init(initScene.resolution.width, initScene.resolution.height, initScene.fps)
  syncCtxToTerminal(ctx, sink)

  let abortRequested = false
  let pendingInput: PendingInput | undefined
  let stdinCleanup: (() => void) | undefined
  if (process.stdin.isTTY && !opts.noDisplay) {
    readline.emitKeypressEvents(process.stdin)
    process.stdin.setRawMode(true)
    const onKeypress = (_str: string, key: readline.Key | undefined): void => {
      if (!key) return
      if (key.name === 'escape') abortRequested = true
      if (key.ctrl && key.name === 'c') abortRequested = true
      if (key.name === 'space') pendingInput = { type: 'pause-toggle' }
      if (key.name === 'up') pendingInput = { type: 'rate', factor: 2 }
      if (key.name === 'down') pendingInput = { type: 'rate', factor: 0.5 }
      if (key.name === 'left') pendingInput = loaded.kind === 'demo' ? 'previous' : { type: 'seek', delta: -5 }
      if (key.name === 'right') pendingInput = loaded.kind === 'demo' ? 'next' : { type: 'seek', delta: 5 }
    }
    process.stdin.on('keypress', onKeypress)
    stdinCleanup = () => {
      process.stdin.removeListener('keypress', onKeypress)
      if (process.stdin.isTTY) process.stdin.setRawMode(false)
      // Keypress handling put stdin in flowing mode; pause it or its handle keeps the process alive.
      process.stdin.pause()
    }
  }

  let framesRendered = 0
  let aborted        = false

  try {
    const r = loaded.kind === 'scene'
      ? await (async () => {
        const runtime = await createSceneRuntime(loaded.scene, {
          sinkId: 'terminal',
          buildRegistry,
          assetManager: {
            resolveAssetUrl(url) {
              if (/^([a-z]+:)?\/\//i.test(url) || url.startsWith('overscan://')) return url
              return loader.resolveScenePath(scenePath, url)
            },
            loadText(path) {
              return readFile(path, 'utf8')
            },
            loadBinary(path) {
              return readFile(path)
            },
          },
        })
        resizeExecutors.push(runtime.executor)
        ctx.assets = runtime.assets
        runtime.executor.init(ctx)
        await syncSceneAudio(audio, loader, scenePath, loaded.scene, opts.seek ?? 0, true, opts.rate ?? 1)
        return renderLoop({
          scene: loaded.scene,
          pool,
          timeline: runtime.timeline,
          executor: runtime.executor,
          ctx,
          sink,
          outputNodeId: runtime.outputNodeId,
          maxFrames: opts.maxFrames ?? Infinity,
          checkAbort: () => abortRequested,
          ...(opts.seek !== undefined || opts.rate !== undefined
            ? { clock: { seek: opts.seek ?? 0, rate: opts.rate ?? 1 } }
            : {}),
          ...(opts.profileEvery !== undefined ? { profileEvery: opts.profileEvery } : {}),
          onClockChange: state => syncSceneAudio(audio, loader, scenePath, loaded.scene, state.time, state.playing, state.rate),
          consumeControl: () => {
            const input = pendingInput
            pendingInput = undefined
            return input && input !== 'previous' && input !== 'next' ? input : undefined
          },
        })
      })()
      : await (async () => {
        const r = await runDemo(scenePath, loaded.demo, sink, ctx, pool, opts, (executor) => {
          resizeExecutors.push(executor)
        }, () => abortRequested, () => {
          const input = pendingInput
          pendingInput = undefined
          return input
        })
        return r
      })()
    framesRendered = r.framesRendered
    aborted = r.aborted
  } finally {
    await audio?.dispose()
    stdinCleanup?.()
    await sink.flush()
    if (process.env['DEMO_SILENT_EXIT'] !== '1') {
      const reason = aborted ? 'user' : 'done'
      console.error(`[demo] exit reason=${reason} frames=${framesRendered} ${describeTerminalSession(sink)}`)
    }
  }
}

async function loadTerminalDemoRuntime(
  loader: SceneLoader,
  demoPath: string,
  demo: Demo,
): Promise<DemoRuntimeDocument> {
  return createDemoRuntimeDocument(demo, {
    sinkId: 'terminal',
    buildRegistry,
    assetManager: fileAssetOptions(loader, demoPath),
    // Each section's relative assets (shaders, textures) resolve against its own scene file.
    sectionAssetManager: scenePath => fileAssetOptions(loader, scenePath),
    async loadSection(rawScenePath) {
      const scenePath = loader.resolveScenePath(demoPath, rawScenePath)
      const scene = await loader.loadFile(scenePath)
      return { scene, scenePath }
    },
  })
}

async function syncSceneAudio(
  audio: TerminalAudioController | null,
  loader: SceneLoader,
  scenePath: string,
  scene: Scene,
  time: number,
  playing: boolean,
  rate: number,
): Promise<void> {
  const state = buildSceneAudioState(loader, scenePath, scene, time, playing, rate)
  await audio?.sync('scene', state)
}

async function syncDemoAudio(
  audio: TerminalAudioController | null,
  loader: SceneLoader,
  demoPath: string,
  demo: Demo,
  scenes: DemoRuntimeDocument['sections'],
  time: number,
  playing: boolean,
  rate: number,
): Promise<void> {
  const states = buildDemoAudioStates(loader, demoPath, demo, scenes, time, playing, rate)
  await audio?.sync('demo', states.demo)
  await audio?.sync('scene', states.scene)
}

function buildSceneAudioState(
  loader: SceneLoader,
  scenePath: string,
  scene: Scene,
  time: number,
  playing: boolean,
  rate: number,
): TerminalAudioState | null {
  if (!scene.audio) return null
  const source = typeof scene.audio === 'string' ? scene.audio : scene.audio.src
  return {
    source: loader.resolveScenePath(scenePath, source),
    time,
    rate,
    playing,
    loop: false,
  }
}

function buildDemoAudioStates(
  loader: SceneLoader,
  demoPath: string,
  demo: Demo,
  scenes: DemoRuntimeDocument['sections'],
  time: number,
  playing: boolean,
  rate: number,
): { demo: TerminalAudioState | null; scene: TerminalAudioState | null } {
  const active = scenes.find(section => time >= section.start && time < section.end) ?? scenes.at(-1)
  if (!active) return { demo: null, scene: null }
  const demoAudioSource = typeof demo.audio === 'string' ? demo.audio : demo.audio?.src
  const demoState = demo.audio
    ? {
        source: loader.resolveScenePath(demoPath, demoAudioSource!),
        time,
        rate,
        playing,
        loop: demo.loop ?? false,
      } satisfies TerminalAudioState
    : null
  if (active.runtime.scene.audio) {
    const sceneAudioSource = typeof active.runtime.scene.audio === 'string'
      ? active.runtime.scene.audio
      : active.runtime.scene.audio.src
    return {
      demo: demoState,
      scene: {
        source: loader.resolveScenePath(active.scenePath, sceneAudioSource),
        time: Math.max(0, time - active.start),
        rate,
        playing,
        loop: false,
      },
    }
  }
  return {
    demo: demoState,
    scene: null,
  }
}
