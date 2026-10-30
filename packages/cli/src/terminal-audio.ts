import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import net from 'node:net'

export interface TerminalAudioState {
  source: string
  time: number
  rate: number
  playing: boolean
  loop: boolean
}

export interface TerminalAudioController {
  sync(key: string, next: TerminalAudioState | null): Promise<void>
  dispose(): Promise<void>
}

const DRIFT_TOLERANCE_SECONDS = 0.2

function terminalAudioStateMatches(prev: TerminalAudioState, next: TerminalAudioState): boolean {
  return prev.source === next.source
    && prev.loop === next.loop
    && prev.playing === next.playing
    && prev.rate === next.rate
    && Math.abs(prev.time - next.time) <= DRIFT_TOLERANCE_SECONDS
}
const activeAudioChildren = new Set<ChildProcess>()
let cleanupHooksInstalled = false

export function createTerminalAudioController(): TerminalAudioController | null {
  ensureCleanupHooks()
  const runtimeDir = join(tmpdir(), `overscan-mpv-${process.pid}-${randomUUID()}`)
  const tracks = new Map<string, TrackHandle>()
  const runtimeReady = fs.mkdir(runtimeDir, { recursive: true })
  let mpvMissingWarned = false

  /** Tracks whose mpv process is still starting; `sync` records the latest wanted state meanwhile. */
  const starting = new Map<string, Promise<void>>()
  const wanted = new Map<string, TerminalAudioState | null>()
  let mpvMissing = false

  const warnMissing = (): void => {
    if (!mpvMissingWarned) {
      console.warn('[demo] mpv not found on PATH; continuing without terminal audio')
      mpvMissingWarned = true
    }
  }

  async function apply(track: TrackHandle, next: TerminalAudioState | null): Promise<void> {
    if (!isUsable(track.child) || !track.client) return
    if (!next) {
      await sendCommand(track.client, ['set_property', 'pause', true]).catch(() => {})
      track.last = null
      return
    }
    const previous = track.last
    if (previous && terminalAudioStateMatches(previous, next)) {
      track.last = { ...next }
      return
    }
    const sourceChanged = previous?.source !== next.source
    const drifted = !previous || Math.abs(previous.time - next.time) > DRIFT_TOLERANCE_SECONDS
    if (sourceChanged) {
      await sendCommand(track.client, ['loadfile', next.source, 'replace'])
    }
    const commands: (readonly unknown[])[] = [
      ['set_property', 'loop-file', next.loop ? 'inf' : 'no'],
      ['set_property', 'speed', sanitizeNumber(next.rate, 1)],
      ['set_property', 'pause', !next.playing],
    ]
    if (sourceChanged || drifted) {
      commands.push(['set_property', 'time-pos', Math.max(0, sanitizeNumber(next.time))])
    }
    for (const command of commands) await sendCommand(track.client, command)
    track.last = { ...next }
  }

  return {
    async sync(key, next) {
      if (mpvMissing) return
      const track = tracks.get(key)
      if (track && isUsable(track.child)) {
        await apply(track, next)
        return
      }
      if (!next) return
      wanted.set(key, next)
      if (starting.has(key)) return
      // Start mpv without blocking the caller: its IPC socket can take seconds to appear, and the
      // render loop must keep drawing meanwhile. The latest wanted state is applied once it is ready.
      starting.set(key, (async () => {
        try {
          await runtimeReady
          const created = await createTrackHandle(runtimeDir, key)
          tracks.set(key, created)
          await apply(created, wanted.get(key) ?? null)
        } catch (error) {
          if (isMissingMpv(error) || isProbablyMissingMpv(error)) {
            mpvMissing = true
            warnMissing()
          } else {
            console.warn(`[demo] terminal audio unavailable: ${error instanceof Error ? error.message : String(error)}`)
            mpvMissing = true
          }
        } finally {
          starting.delete(key)
        }
      })())
    },
    async dispose() {
      await Promise.all(starting.values())
      await Promise.all([...tracks.values()].map(async track => {
        if (track.client) {
          await sendCommand(track.client, ['quit']).catch(() => {})
          track.client.end()
          track.client.destroy()
        }
        await waitForExit(track.child)
        if (track.socketPath.startsWith('\\\\.\\pipe\\')) return
        await fs.rm(track.socketPath, { force: true }).catch(() => {})
      }))
      tracks.clear()
      await fs.rm(runtimeDir, { recursive: true, force: true }).catch(() => {})
    },
  }
}

interface TrackHandle {
  child: ChildProcess
  client: net.Socket | null
  socketPath: string
  last: TerminalAudioState | null
}

function sanitizeNumber(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback
}

async function createTrackHandle(runtimeDir: string, key: string): Promise<TrackHandle> {
  const socketPath = makeSocketPath(runtimeDir, key)
  const args = [
    '--idle=yes',
    '--force-window=no',
    '--audio-display=no',
    '--keep-open=yes',
    '--really-quiet',
    `--input-ipc-server=${socketPath}`,
  ]
  const child = spawn('mpv', args, {
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  })
  activeAudioChildren.add(child)
  child.once('exit', () => {
    activeAudioChildren.delete(child)
  })
  await waitForSpawn(child)
  const client = await connectToIpc(socketPath, child)
  child.stderr.on('data', () => {})
  // mpv emits JSON events/responses; if unread, the IPC pipe buffer can fill and stall playback.
  client.on('data', () => {})
  return { child, client, socketPath, last: null }
}

function isUsable(child: ChildProcess): boolean {
  return !child.killed && child.exitCode === null
}

function waitForExit(child: ChildProcess): Promise<void> {
  return new Promise(resolve => {
    if (!isUsable(child)) {
      resolve()
      return
    }
    child.once('exit', () => { resolve(); })
    setTimeout(() => {
      void terminateChildProcess(child).finally(resolve)
    }, 750)
  })
}

function waitForSpawn(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('spawn', () => { resolve(); })
  })
}

async function connectToIpc(socketPath: string, child: ChildProcess): Promise<net.Socket> {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (!isUsable(child)) throw new Error('mpv exited before IPC became available')
    try {
      const socket = await new Promise<net.Socket>((resolve, reject) => {
        const client = net.createConnection(socketPath, () => { resolve(client); })
        client.once('error', reject)
      })
      socket.setEncoding('utf8')
      return socket
    } catch {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
  throw new Error('Timed out waiting for mpv IPC socket')
}

function sendCommand(socket: net.Socket, command: readonly unknown[]): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.write(`${JSON.stringify({ command })}\n`, error => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function makeSocketPath(runtimeDir: string, key: string): string {
  const suffix = `${process.pid}-${key}-${randomUUID()}`
  if (process.platform === 'win32') return `\\\\.\\pipe\\overscan-mpv-${suffix}`
  return join(runtimeDir, `${key}.sock`)
}

function isMissingMpv(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT')
}

function isProbablyMissingMpv(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return /spawn mpv/i.test(error.message) || /mpv exited before IPC became available/i.test(error.message)
}

function ensureCleanupHooks(): void {
  if (cleanupHooksInstalled) return
  cleanupHooksInstalled = true
  process.once('exit', cleanupActiveAudioChildren)
  process.once('SIGINT', () => {
    cleanupActiveAudioChildren()
    process.exit(130)
  })
  process.once('SIGTERM', () => {
    cleanupActiveAudioChildren()
    process.exit(143)
  })
  process.once('uncaughtException', error => {
    cleanupActiveAudioChildren()
    throw error
  })
  process.once('unhandledRejection', reason => {
    cleanupActiveAudioChildren()
    throw reason instanceof Error ? reason : new Error(String(reason))
  })
}

function cleanupActiveAudioChildren(): void {
  for (const child of activeAudioChildren) {
    void terminateChildProcess(child)
  }
  activeAudioChildren.clear()
}

async function terminateChildProcess(child: ChildProcess): Promise<void> {
  if (!isUsable(child)) return
  if (process.platform === 'win32' && typeof child.pid === 'number') {
    await new Promise<void>(resolve => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      })
      killer.once('exit', () => { resolve(); })
      killer.once('error', () => {
        try {
          child.kill()
        } catch {
          // Already exited.
        }
        resolve()
      })
    })
    return
  }
  try {
    child.kill('SIGKILL')
  } catch {
    // Already exited.
  }
}
