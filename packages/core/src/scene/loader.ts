import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import type { Demo, Scene } from '@overscan/types'
import { parseDemoJson, parseSceneJson } from './parse.js'

export { DemoSchema, SceneSchema, parseDemoJson, parseSceneJson } from './parse.js'

export type LoadedFile =
  | { kind: 'scene'; path: string; scene: Scene }
  | { kind: 'demo'; path: string; demo: Demo }

export class SceneLoader {
  async loadFile(path: string): Promise<Scene> {
    const raw = await readFile(path, 'utf8')
    return parseSceneJson(raw)
  }

  async loadAnyFile(path: string): Promise<LoadedFile> {
    const raw = await readFile(path, 'utf8')
    if (path.endsWith('.demo.json')) {
      return { kind: 'demo', path, demo: parseDemoJson(raw) }
    }
    return { kind: 'scene', path, scene: parseSceneJson(raw) }
  }

  resolveScenePath(baseFile: string, scenePath: string): string {
    return this.resolveAssetPath(baseFile, scenePath)
  }

  resolveAssetPath(baseFile: string, assetPath: string): string {
    if (isAbsolute(assetPath)) return assetPath
    return resolve(dirname(baseFile), assetPath)
  }

  loadJSON(json: string): Scene {
    return parseSceneJson(json)
  }
}
