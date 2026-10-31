import type { AssetManager, LoadedImageAsset, Scene } from '@overscan/types'

const ASSET_CONFIG_KEYS = new Set(['textureUrl', 'imageUrl', 'heightmap', 'colormap', 'backgroundUrl', 'font', 'scenePath', 'shaderPath'])

const IMAGE_EXTENSIONS = /\.(png|jpg|jpeg|bmp|gif|webp)$/i

export interface AssetManagerOptions {
  resolveAssetUrl(url: string): string
  loadText(path: string): Promise<string>
  /**
   * Load a file as raw bytes. Required for external image assets (PNG, JPEG, etc.).
   * In Node.js: `(path) => fs.readFile(path)`
   * In browser: `(url) => fetch(url).then(r => r.arrayBuffer()).then(b => new Uint8Array(b))`
   */
  loadBinary?: (path: string) => Promise<Uint8Array>
  /**
   * Decode raw image bytes into a LoadedImageAsset.
   * In Node.js: implement with `sharp` or `pngjs`.
   * In browser: implement with `createImageBitmap` + an OffscreenCanvas.
   * If omitted, external image files are loaded as binary but cannot be decoded —
   * nodes will fall back to their built-in procedural patterns.
   */
  decodeImage?: (data: Uint8Array) => Promise<LoadedImageAsset | undefined>
}

export class SceneAssetManager implements AssetManager {
  private textAssets = new Map<string, string>()
  private imageAssets = new Map<string, LoadedImageAsset>()
  private errors = new Map<string, string>()

  constructor(private readonly options: AssetManagerOptions) {}

  async preloadScene(scene: Scene): Promise<void> {
    const urls = new Set<string>()
    for (const node of scene.graph.nodes) this.collectConfigUrls(node.config, urls)
    await Promise.all([...urls].map(async (url) => {
      if (this.textAssets.has(url) || this.imageAssets.has(url) || this.errors.has(url)) return
      const resolved = this.options.resolveAssetUrl(url)
      if (resolved.startsWith('overscan://')) {
        const builtin = createBuiltinImageAsset(resolved)
        if (builtin) this.imageAssets.set(url, builtin)
        else this.errors.set(url, `Unknown built-in asset '${url}'`)
        return
      }
      if (IMAGE_EXTENSIONS.test(resolved)) {
        await this.loadImageAsset(url, resolved)
        return
      }
      try {
        const raw = await this.options.loadText(resolved)
        this.textAssets.set(url, raw)
        const parsed = tryParseImageAsset(raw)
        if (parsed) this.imageAssets.set(url, parsed)
      } catch (error) {
        this.errors.set(url, error instanceof Error ? error.message : String(error))
      }
    }))
  }

  private async loadImageAsset(url: string, resolved: string): Promise<void> {
    if (!this.options.loadBinary) {
      this.errors.set(url, `Cannot load image '${url}': provide a loadBinary handler in AssetManagerOptions`)
      return
    }
    let data: Uint8Array
    try {
      data = await this.options.loadBinary(resolved)
    } catch (error) {
      this.errors.set(url, error instanceof Error ? error.message : String(error))
      return
    }
    if (!this.options.decodeImage) {
      this.errors.set(url, `Image '${url}' loaded but not decoded: provide a decodeImage handler in AssetManagerOptions`)
      return
    }
    try {
      const decoded = await this.options.decodeImage(data)
      if (decoded) this.imageAssets.set(url, decoded)
      else this.errors.set(url, `Failed to decode image '${url}'`)
    } catch (error) {
      this.errors.set(url, error instanceof Error ? error.message : String(error))
    }
  }

  getText(url: string): string | undefined {
    return this.textAssets.get(url)
  }

  getImage(url: string): LoadedImageAsset | undefined {
    return this.imageAssets.get(url) ?? createBuiltinImageAsset(url)
  }

  getError(url: string): string | undefined {
    return this.errors.get(url)
  }

  private collectConfigUrls(value: unknown, urls: Set<string>, key?: string): void {
    // Built-in bitmap fonts (`overscan://fonts/…`) are drawn by @overscan/text, not loaded as assets.
    if (typeof value === 'string' && key && ASSET_CONFIG_KEYS.has(key) && value !== '' && value !== 'noise' && value !== 'auto' && !value.startsWith('overscan://fonts/')) {
      urls.add(value)
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) this.collectConfigUrls(item, urls)
      return
    }
    if (value && typeof value === 'object') {
      for (const [childKey, childValue] of Object.entries(value)) {
        this.collectConfigUrls(childValue, urls, childKey)
      }
    }
  }
}

export function createAssetManager(options: AssetManagerOptions): SceneAssetManager {
  return new SceneAssetManager(options)
}

function tryParseImageAsset(raw: string): LoadedImageAsset | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== 'object') return undefined
  const width = getFiniteNumber(parsed, 'width')
  const height = getFiniteNumber(parsed, 'height')
  const data = (parsed as { data?: unknown }).data
  if (!width || !height || !Array.isArray(data) || data.length !== width * height * 4) return undefined
  const out = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < out.length; i++) out[i] = clampByte(data[i])
  return { width, height, data: out }
}

function getFiniteNumber(value: object, key: string): number | undefined {
  const candidate = (value as Record<string, unknown>)[key]
  if (typeof candidate !== 'number' || !Number.isFinite(candidate)) return undefined
  return Math.max(1, Math.round(candidate))
}

function clampByte(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(255, Math.round(value)))
}

function createBuiltinImageAsset(url: string): LoadedImageAsset | undefined {
  switch (url) {
    case 'overscan://checkerboard':
      return makeCheckerboardAsset()
    case 'overscan://stripes':
      return makeStripesAsset()
    case 'overscan://terrain-ramp':
      return makeTerrainRampAsset()
    default:
      return undefined
  }
}

function makeCheckerboardAsset(): LoadedImageAsset {
  const width = 64
  const height = 64
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const checker = ((x >> 3) + (y >> 3)) & 1
      const base = checker === 0 ? [20, 18, 60] : [248, 120, 24]
      data[i] = base[0] ?? 0
      data[i + 1] = base[1] ?? 0
      data[i + 2] = base[2] ?? 0
      data[i + 3] = 255
    }
  }
  return { width, height, data }
}

function makeStripesAsset(): LoadedImageAsset {
  const width = 64
  const height = 64
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const band = (Math.sin((x / width) * Math.PI * 8) * 0.5 + 0.5)
      data[i] = clampByte(50 + band * 180)
      data[i + 1] = clampByte(40 + (1 - band) * 140)
      data[i + 2] = clampByte(140 + band * 100)
      data[i + 3] = 255
    }
  }
  return { width, height, data }
}

function makeTerrainRampAsset(): LoadedImageAsset {
  const width = 256
  const height = 1
  const data = new Uint8ClampedArray(width * height * 4)
  for (let x = 0; x < width; x++) {
    const t = x / (width - 1)
    const low: [number, number, number] = [18, 36, 61]
    const mid: [number, number, number] = [46, 115, 56]
    const high: [number, number, number] = [184, 173, 115]
    const color = t < 0.45 ? blendRgb(low, mid, t / 0.45) : blendRgb(mid, high, (t - 0.45) / 0.55)
    const i = x * 4
    data[i] = color[0]
    data[i + 1] = color[1]
    data[i + 2] = color[2]
    data[i + 3] = 255
  }
  return { width, height, data }
}

function blendRgb(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  return [
    Math.round(a[0] + (b[0] - a[0]) * x),
    Math.round(a[1] + (b[1] - a[1]) * x),
    Math.round(a[2] + (b[2] - a[2]) * x),
  ]
}
