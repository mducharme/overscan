import type { AssetManager, Demo, NodeContext, Scene } from '@overscan/types'
import {
  createAssetManager,
  createBrowserTimeSource,
  GraphExecutor,
  parseDemoJson,
  parseSceneJson,
  PlaybackClock,
  renderSceneFrame,
  RocketTimeline,
  WebglBufferPool,
} from '@overscan/core/browser'
import { buildBuiltinRegistry } from '@overscan/nodes/browser'
import {
  buildDemoRuntimeSections,
  findActiveDemoSectionIndex,
  renderDemoBuffer,
} from '@overscan/sequencer'
import { WebglDisplaySink } from '@overscan/sink-browser'

import demoText from '../../advanced.demo.json?raw'

interface SceneRuntime {
  scene: Scene
  timeline: RocketTimeline
  executor: GraphExecutor
  outputNodeId: string
  assets: AssetManager
}

async function makeSceneRuntime(scene: Scene, scenePath: string): Promise<SceneRuntime> {
  const timeline = new RocketTimeline()
  timeline.load(scene.tracks)
  const assets = createAssetManager({
    resolveAssetUrl(url) {
      if (/^([a-z]+:)?\/\//i.test(url) || url.startsWith('overscan://')) return url
      return new URL(url, import.meta.url).toString()
    },
    async loadText(path) {
      const response = await fetch(path)
      if (!response.ok) {
        throw new Error(`Failed to fetch asset '${scenePath}': ${response.status} ${response.statusText}`)
      }
      return response.text()
    },
  })
  await assets.preloadScene(scene)
  const executor = new GraphExecutor()
  executor.load(scene.graph, buildBuiltinRegistry(scene.graph.nodes))
  const outputNodeId = scene.graph.outputs.browser ?? scene.graph.nodes[0]?.id
  if (!outputNodeId) throw new Error(`No browser output for ${scene.id}`)
  return { scene, timeline, executor, outputNodeId, assets }
}

async function main(): Promise<void> {
  const showcaseMeta = parseDemoJson(demoText)
  const sceneModules = {
    ...import.meta.glob('../../generators/*.scene.json', { eager: true, query: '?raw', import: 'default' }),
    ...import.meta.glob('../../modifiers/*.scene.json', { eager: true, query: '?raw', import: 'default' }),
    ...import.meta.glob('../../compositors/*.scene.json', { eager: true, query: '?raw', import: 'default' }),
    ...import.meta.glob('../../signals/*.scene.json', { eager: true, query: '?raw', import: 'default' }),
    ...import.meta.glob('../../advanced/*.scene.json', { eager: true, query: '?raw', import: 'default' }),
  } as Record<string, string>
  const scenePaths = Object.keys(sceneModules)
    .map(path => path.replace('../../', './'))
    .sort((a, b) => a.localeCompare(b))
  const scenesByPath = Object.fromEntries(
    scenePaths.map(scenePath => {
      const modulePath = `../../${scenePath.slice(2)}`
      return [scenePath, parseSceneJson(sceneModules[modulePath] ?? '')]
    }),
  ) as Record<string, Scene>
  const demo: Demo = {
    ...showcaseMeta,
    sections: scenePaths.map(scenePath => ({
      id: scenePath.replace(/^\.\//, '').replace(/\.scene\.json$/, '').replace(/\//g, '-'),
      scene: scenePath,
      duration: 10,
      transition: { type: 'cut' as const },
    })),
  }

  const { sections } = await buildDemoRuntimeSections(demo, async scenePath => {
    const scene = scenesByPath[scenePath]
    if (!scene) throw new Error(`Missing browser scene source for ${scenePath}`)
    return {
      scene,
      scenePath,
      runtime: await makeSceneRuntime(scene, scenePath),
    }
  })

  const firstSection = sections[0]
  if (!firstSection) throw new Error('No browser scene available')
  // Typed without `undefined` so the render loop's hoisted functions see it as present.
  const firstScene: Scene = firstSection.runtime.scene

  const canvas = document.getElementById('screen') as HTMLCanvasElement | null
  if (!canvas) throw new Error('#screen canvas missing')

  const hud = document.createElement('div')
  hud.style.position = 'fixed'
  hud.style.left = '12px'
  hud.style.top = '12px'
  hud.style.padding = '8px 10px'
  hud.style.background = 'rgba(0, 0, 0, 0.72)'
  hud.style.border = '1px solid rgba(255,255,255,0.12)'
  hud.style.color = '#d9e7ff'
  hud.style.font = '12px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace'
  hud.style.whiteSpace = 'pre-line'
  hud.style.pointerEvents = 'none'
  hud.style.zIndex = '10'
  document.body.appendChild(hud)

  const sink = new WebglDisplaySink(canvas)
  await sink.init(firstScene.resolution.width, firstScene.resolution.height, firstScene.fps)
  const pool = new WebglBufferPool(sink.context)

  const ctx: NodeContext = {
    canvas: null,
    ctx2d: null,
    gl: sink.context,
    assets: firstSection.runtime.assets,
    pool,
    width: firstScene.resolution.width,
    height: firstScene.resolution.height,
  }

  for (const section of sections) {
    ctx.assets = section.runtime.assets
    section.runtime.executor.init(ctx)
  }

  const clock = new PlaybackClock(createBrowserTimeSource())
  const frameMs = 1000 / firstScene.fps
  let frame = 0
  let nextFrameMs = performance.now() + frameMs
  let prevT = clock.currentTime()
  const endTime = sections[sections.length - 1]?.end ?? 0
  const loopDemo = demo.loop ?? false

  function schedule(): void {
    requestAnimationFrame(nowMs => {
      void frameStep(nowMs)
    })
  }

  async function frameStep(nowMs: number): Promise<void> {
    if (nowMs < nextFrameMs) {
      schedule()
      return
    }
    while (nowMs > nextFrameMs + frameMs) nextFrameMs += frameMs
    nextFrameMs += frameMs

    let t = clock.currentTime()
    if (loopDemo && endTime > 0 && t >= endTime) {
      clock.seek(0)
      t = clock.currentTime()
      prevT = t
    }

    const dt = frame === 0 ? 0 : Math.max(0, t - prevT) || (1 / firstScene.fps)
    const activeIdx = findActiveDemoSectionIndex(sections, t)
    if (activeIdx < 0) {
      if (loopDemo && endTime > 0) {
        schedule()
        return
      }
      return
    }

    const active = sections[activeIdx]
    if (!active) {
      schedule()
      return
    }
    const rendered = renderDemoBuffer({
      pool,
      ctx,
      sections,
      t,
      frame,
      dt,
      setContextAssets(localCtx, runtime) {
        localCtx.assets = runtime.assets
      },
      renderSection(runtime, localTime, localFrame, localDt) {
        return renderSceneFrame({
          scene: runtime.scene,
          timeline: runtime.timeline,
          executor: runtime.executor,
          pool,
          ctx,
          outputNodeId: runtime.outputNodeId,
        }, localTime, localFrame, localDt)
      },
    })

    if (!rendered) {
      schedule()
      return
    }

    ctx.assets = active.runtime.assets
    await sink.write(rendered.buffer, frame, rendered.signal)
    const renderer = ctx.gl ? (rendered.buffer.texture ? 'webgl' : 'cpu->webgl') : 'cpu'
    const transition = active.transitionType === 'cut'
      ? 'cut'
      : `${active.transitionType} ${active.transitionDuration.toFixed(2)}s`
    hud.textContent =
      `scene: ${active.id} (${active.runtime.scene.title})\n` +
      `renderer: ${renderer}\n` +
      `resolution: ${ctx.width}x${ctx.height}\n` +
      `fps: ${active.runtime.scene.fps}\n` +
      `time: ${t.toFixed(2)}s\n` +
      `transition: ${transition}`

    pool.release(rendered.buffer)
    frame++
    prevT = t

    if (!loopDemo && endTime > 0 && t >= endTime) return
    schedule()
  }

  schedule()
}

void main()
