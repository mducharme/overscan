/**
 * Browser / Vite entry — no `node:fs` or `node:module` (no node-canvas probe).
 * Use with `import { … } from '@overscan/core/browser'`.
 */
export { GraphExecutor, validateSceneGraph } from './graph/executor.js'
export { samplePixel } from './pixel/transform-sample.js'
export { BufferPoolBrowser } from './buffer/pool-browser.js'
export { WebglBufferPool } from './buffer/pool-webgl.js'
export { PlaybackClock, createBrowserTimeSource, type TimeSource } from './clock/playback-clock.js'
export { RocketTimeline } from './timeline/rocket.js'
export { buildSignal } from './signal/builder.js'
export { parseDemoJson, parseSceneJson, DemoSchema, SceneSchema } from './scene/parse.js'
export { createAssetManager, SceneAssetManager, type AssetManagerOptions } from './scene/asset-manager.js'
export { renderSceneFrame, type ScenePlayer, type RenderedFrame } from './player/render-frame.js'
export {
  applyModifierStack,
  buildDemoModifierStack,
  createDemoRuntimeDocument,
  createSceneRuntime,
  renderDemoRuntimeFrame,
  renderSceneRuntimeFrame,
  type DemoRuntimeDocument,
  type RuntimeRegistryFactory,
  type SceneRuntime,
} from './player/runtime.js'
