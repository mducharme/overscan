import type { IncomingMessage, ServerResponse } from 'node:http'
import { createReadStream } from 'node:fs'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

type AsyncHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>

/** Connect ignores the promise an async handler returns; route its rejections to `next`. */
function handleAsync(handler: AsyncHandler) {
  return (req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void): void => {
    handler(req, res).catch(next)
  }
}
import { createServer, type Plugin } from 'vite'

function studioRoot(): string {
  return fileURLToPath(new URL('../../../studio', import.meta.url))
}

function normalizeFilePath(filePath: string, base = process.cwd()): string {
  const resolved = path.resolve(base, filePath)
  const prefix = base.endsWith(path.sep) ? base : base + path.sep
  if (resolved !== base && !resolved.startsWith(prefix)) {
    throw new Error('Path outside project directory is not allowed')
  }
  return resolved
}

const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'coverage'])
const MAX_LISTED = 2000

/** Scene and demo files under `root`, skipping dependencies, build output and dot directories. */
async function listDocuments(root: string): Promise<string[]> {
  const found: string[] = []
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (found.length >= MAX_LISTED) return
      if (entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) await walk(full)
      } else if (entry.name.endsWith('.scene.json') || entry.name.endsWith('.demo.json')) {
        found.push(full)
      }
    }
  }
  await walk(root)
  return found.sort()
}

function contentTypeFor(targetPath: string): string {
  switch (path.extname(targetPath).toLowerCase()) {
    case '.mp3': return 'audio/mpeg'
    case '.wav': return 'audio/wav'
    case '.ogg': return 'audio/ogg'
    case '.json': return 'application/json; charset=utf-8'
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    default: return 'application/octet-stream'
  }
}

function makeStudioBridge(filePath: string): Plugin {
  const normalized = normalizeFilePath(filePath)

  async function sendFile(res: { setHeader(name: string, value: string): void; end(body?: string): void; statusCode: number }, targetPath: string): Promise<void> {
    const [text, info] = await Promise.all([
      readFile(targetPath, 'utf8'),
      stat(targetPath),
    ])
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({
      filePath: targetPath,
      text,
      mtimeMs: info.mtimeMs,
    }))
  }

  async function sendFileStat(res: { setHeader(name: string, value: string): void; end(body?: string): void; statusCode: number }, targetPath: string): Promise<void> {
    const info = await stat(targetPath)
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({
      filePath: targetPath,
      mtimeMs: info.mtimeMs,
    }))
  }

  async function sendAsset(
    req: { headers: Record<string, string | string[] | undefined> },
    res: {
      setHeader(name: string, value: string): void
      end(body?: Uint8Array | string): void
      statusCode: number
      writeHead(statusCode: number, headers: Record<string, string | number>): void
    },
    targetPath: string,
  ): Promise<void> {
    const info = await stat(targetPath)
    const contentType = contentTypeFor(targetPath)
    const rangeHeader = req.headers['range']
    const range = Array.isArray(rangeHeader) ? rangeHeader[0] : rangeHeader

    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('Content-Type', contentType)

    if (!range) {
      res.setHeader('Content-Length', String(info.size))
      res.end(await readFile(targetPath))
      return
    }

    const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim())
    if (!match) {
      res.statusCode = 416
      res.setHeader('Content-Range', `bytes */${info.size}`)
      res.end()
      return
    }

    const start = match[1] ? Number(match[1]) : 0
    const end = match[2] ? Number(match[2]) : info.size - 1

    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || end >= info.size) {
      res.statusCode = 416
      res.setHeader('Content-Range', `bytes */${info.size}`)
      res.end()
      return
    }

    res.writeHead(206, {
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${start}-${end}/${info.size}`,
      'Content-Length': end - start + 1,
      'Cache-Control': 'no-cache',
    })

    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(targetPath, { start, end })
      stream.once('error', reject)
      stream.once('end', () => { resolve(); })
      stream.pipe(res as never)
    })
  }

  return {
    name: 'overscan-studio-bridge',
    configureServer(server) {
      server.middlewares.use('/__overscan__/file', handleAsync(async (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.end('Method not allowed')
          return
        }

        try {
          await sendFile(res, normalized)
        } catch (error) {
          res.statusCode = 500
          res.end(JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }))
        }
      }))

      server.middlewares.use('/__overscan__/read', handleAsync(async (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.end('Method not allowed')
          return
        }

        try {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const rawPath = url.searchParams.get('path')
          if (!rawPath) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'Missing path query parameter' }))
            return
          }
          await sendFile(res, normalizeFilePath(rawPath))
        } catch (error) {
          res.statusCode = 500
          res.end(JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }))
        }
      }))

      server.middlewares.use('/__overscan__/list', handleAsync(async (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.end('Method not allowed')
          return
        }
        try {
          const root = process.cwd()
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ root, files: await listDocuments(root) }))
        } catch (error) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
        }
      }))

      server.middlewares.use('/__overscan__/stat', handleAsync(async (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.end('Method not allowed')
          return
        }

        try {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const rawPath = url.searchParams.get('path')
          if (!rawPath) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'Missing path query parameter' }))
            return
          }
          await sendFileStat(res, normalizeFilePath(rawPath))
        } catch (error) {
          res.statusCode = 500
          res.end(JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }))
        }
      }))

      server.middlewares.use('/__overscan__/media', handleAsync(async (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.end('Method not allowed')
          return
        }

        try {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const rawPath = url.searchParams.get('path')
          if (!rawPath) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'Missing path query parameter' }))
            return
          }
          await sendAsset(req, res, normalizeFilePath(rawPath))
        } catch (error) {
          res.statusCode = 500
          res.end(JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }))
        }
      }))

      server.middlewares.use('/__overscan__/asset', handleAsync(async (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.end('Method not allowed')
          return
        }

        try {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const rawPath = url.searchParams.get('path')
          if (!rawPath) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'Missing path query parameter' }))
            return
          }
          await sendAsset(req, res, normalizeFilePath(rawPath))
        } catch (error) {
          res.statusCode = 500
          res.end(JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }))
        }
      }))

      server.middlewares.use('/__overscan__/save', handleAsync(async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method not allowed')
          return
        }

        try {
          const chunks: Uint8Array[] = []
          for await (const chunk of req as AsyncIterable<string | Uint8Array>) {
            chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
          }
          const body = Buffer.concat(chunks).toString('utf8')
          const payload = JSON.parse(body) as { text?: string; filePath?: string }
          if (typeof payload.text !== 'string') {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'Missing text payload' }))
            return
          }
          const targetPath = normalizeFilePath(payload.filePath ?? normalized)
          await writeFile(targetPath, payload.text, 'utf8')
          const info = await stat(targetPath)
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true, filePath: targetPath, mtimeMs: info.mtimeMs }))
        } catch (error) {
          res.statusCode = 500
          res.end(JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }))
        }
      }))
    },
  }
}

export interface DevOptions {
  /** Open the studio in the default browser (default true). */
  open?: boolean
}

export async function dev(filePath: string, options: DevOptions = {}): Promise<void> {
  const normalized = normalizeFilePath(filePath)
  const fileType = normalized.endsWith('.demo.json') ? 'demo' : 'scene'
  const server = await createServer({
    root: studioRoot(),
    server: {
      port: 4242,
      // The file is baked in through __OVERSCAN_FILE__: Vite's macOS opener re-encodes the URL, which would mangle an encoded path.
      open: options.open !== false,
    },
    define: {
      __OVERSCAN_FILE__: JSON.stringify(normalized),
      __OVERSCAN_FILE_TYPE__: JSON.stringify(fileType),
    },
    plugins: [makeStudioBridge(normalized)],
  })

  await server.listen()
  server.printUrls()
  console.log(`  overscan studio  ->  http://localhost:4242`)
  console.log(`  editing: ${normalized}`)
}
