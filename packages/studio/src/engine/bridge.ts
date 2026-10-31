/** Client for the dev server's file bridge (`overscan dev`): read, save and stat files, and fetch media. */

export interface BridgeFile {
  filePath: string
  text: string
  mtimeMs: number
}

export interface Bridge {
  read(filePath: string): Promise<BridgeFile>
  save(filePath: string, text: string): Promise<number>
  stat(filePath: string): Promise<number>
  readBinary(filePath: string): Promise<Uint8Array>
  mediaUrl(filePath: string): string
  /** Scene and demo files in the project, for opening another one. */
  list?(): Promise<{ root: string; files: string[] }>
  /** Starts rendering a saved file to GIF, MP4 or PNG frames on the dev server (one export at a time). */
  startExport?(request: ExportRequest): Promise<ExportJob>
  /** The current (or last) export, or null. */
  exportStatus?(): Promise<ExportJob | null>
  cancelExport?(): Promise<void>
}

export type ExportKind = 'gif' | 'mp4' | 'png'

export interface ExportRequest {
  filePath: string
  kind: ExportKind
  output: string
  /** Rasterise like the terminal player instead of rendering at full resolution. */
  terminal?: { mode: 'ansi' | 'ascii'; cols: number; rows: number; cellWidth: number; cellHeight: number }
}

export interface ExportJob {
  id: number
  filePath: string
  output: string
  state: 'running' | 'done' | 'error' | 'cancelled'
  frames: number
  error?: string
}

async function json<T>(response: Response, what: string): Promise<T> {
  const payload = await response.json() as T & { error?: string }
  if (!response.ok || payload.error) throw new Error(payload.error ?? `${what} failed (${response.status})`)
  return payload
}

/** Bridge over HTTP; `fetchImpl` is injectable for tests. */
export function createHttpBridge(fetchImpl: typeof fetch = (...args) => fetch(...args)): Bridge {
  const q = (filePath: string): string => `path=${encodeURIComponent(filePath)}`
  return {
    async read(filePath) {
      return json<BridgeFile>(await fetchImpl(`/__overscan__/read?${q(filePath)}`), `Reading ${filePath}`)
    },
    async save(filePath, text) {
      const response = await fetchImpl('/__overscan__/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath, text }),
      })
      return (await json<{ mtimeMs: number }>(response, `Saving ${filePath}`)).mtimeMs
    },
    async stat(filePath) {
      return (await json<{ mtimeMs: number }>(await fetchImpl(`/__overscan__/stat?${q(filePath)}`), `Checking ${filePath}`)).mtimeMs
    },
    async readBinary(filePath) {
      const response = await fetchImpl(`/__overscan__/media?${q(filePath)}`)
      if (!response.ok) throw new Error(`Loading ${filePath} failed (${response.status})`)
      return new Uint8Array(await response.arrayBuffer())
    },
    mediaUrl(filePath) {
      return `/__overscan__/media?${q(filePath)}`
    },
    async startExport(request) {
      const response = await fetchImpl('/__overscan__/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) })
      return (await json<{ job: ExportJob }>(response, 'Starting the export')).job
    },
    async exportStatus() {
      return (await json<{ job: ExportJob | null }>(await fetchImpl('/__overscan__/export'), 'Checking the export')).job
    },
    async cancelExport() {
      await json(await fetchImpl('/__overscan__/export', { method: 'DELETE' }), 'Cancelling the export')
    },
    async list() {
      return json<{ root: string; files: string[] }>(await fetchImpl('/__overscan__/list'), 'Listing files')
    },
  }
}
