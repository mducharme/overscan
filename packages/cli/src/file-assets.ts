import { readFile } from 'node:fs/promises'
import type { AssetManagerOptions, SceneLoader } from '@overscan/core'

/** Asset options that read from disk and resolve relative URLs against `basePath` (a scene or demo file). */
export function fileAssetOptions(loader: SceneLoader, basePath: string): AssetManagerOptions {
  return {
    resolveAssetUrl(url) {
      if (/^([a-z]+:)?\/\//i.test(url) || url.startsWith('overscan://')) return url
      return loader.resolveScenePath(basePath, url)
    },
    loadText(path) {
      return readFile(path, 'utf8')
    },
    loadBinary(path) {
      return readFile(path)
    },
  }
}
