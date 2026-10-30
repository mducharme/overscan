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
  }
}
