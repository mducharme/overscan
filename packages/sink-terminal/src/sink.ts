import type { Sink, FrameBuffer, Signal, TerminalMode, TerminalSinkOptions } from '@overscan/types'
import { detectMode } from './detect.js'
import { terminalResolution } from './resolution.js'
import { buildTerminalFrameBody, terminalFrameLeader } from './terminal-frame.js'

const DEFAULT_FPS: Record<TerminalMode, number> = {
  sixel: 30,
  ansi:  30,
  ascii: 15,
}

export class TerminalSink implements Sink {
  readonly id = 'terminal'

  private mode: TerminalMode
  private fpsCap: number
  private fullscreen: boolean
  private noDisplay: boolean
  private sourceFps = 0
  private lastFrameTime = BigInt(0)
  private frameNs = BigInt(0)
  private lastStatusFps = 0
  private onResizeCb: (() => void) | undefined = undefined
  private hooksInstalled = false

  private readonly boundExit = (): void => {
    this.restoreTerminalVisuals()
  }

  private readonly boundSig = (): void => {
    this.restoreTerminalVisuals()
    process.exit(0)
  }

  private readonly boundSigWinch = (): void => {
    this.onResizeCb?.()
  }

  private readonly boundStdoutResize = (): void => {
    this.onResizeCb?.()
  }

  constructor(opts: TerminalSinkOptions = {}) {
    this.mode        = opts.mode       ?? detectMode()
    this.fpsCap      = opts.fpsCap     ?? DEFAULT_FPS[this.mode]
    this.fullscreen  = opts.fullscreen ?? true
    this.noDisplay   = opts.noDisplay  ?? false
    this.onResizeCb  = opts.onResize
  }

  /** Register after construction when the callback needs the sink instance. */
  setOnResize(cb: (() => void) | undefined): void {
    this.onResizeCb = cb
  }

  async init(_w: number, _h: number, _fps: number): Promise<void> {
    this.sourceFps = _fps
    this.frameNs = BigInt(Math.round(1_000_000_000 / this.fpsCap))

    if (this.noDisplay || !this.fullscreen || this.hooksInstalled) return

    this.hooksInstalled = true
    process.stdout.write('\x1b[?25l')
    process.stdout.write('\x1b[2J')
    process.stdout.write('\x1b[H')

    process.on('exit', this.boundExit)
    process.on('SIGINT', this.boundSig)
    process.on('SIGTERM', this.boundSig)
    if (process.platform !== 'win32') {
      process.on('SIGWINCH', this.boundSigWinch)
    }
    if (typeof process.stdout.on === 'function') {
      process.stdout.on('resize', this.boundStdoutResize)
    }
  }

  private restoreTerminalVisuals(): void {
    if (this.noDisplay || !this.fullscreen) return
    process.stdout.write('\x1b[?25h')
    process.stdout.write('\x1b[2J')
    process.stdout.write('\x1b[H')
  }

  private removeResizeHooks(): void {
    if (process.platform !== 'win32') {
      process.off('SIGWINCH', this.boundSigWinch)
    }
    if (typeof process.stdout.off === 'function') {
      process.stdout.off('resize', this.boundStdoutResize)
    }
  }

  async write(frame: FrameBuffer, _idx: number, _signal: Signal): Promise<void> {
    const now = process.hrtime.bigint()
    const elapsed = now - this.lastFrameTime
    if (elapsed < this.frameNs) return
    this.lastStatusFps = this.lastFrameTime === BigInt(0)
      ? this.sourceFps
      : 1_000_000_000 / Number(elapsed)
    this.lastFrameTime = now

    if (this.noDisplay) return

    const output = buildTerminalFrameBody(this.mode, frame)

    if (process.env['DEBUG_TERMINAL'] === '1') {
      console.error(
        `[demo-terminal] mode=${this.mode} frame=${frame.width}x${frame.height} outBytes=${Buffer.byteLength(output, 'utf8')}`,
      )
    }

    await writeStdout(terminalFrameLeader(this.mode) + output)
    if (process.env['DEBUG_TERMINAL'] === '1') {
      const row = process.stdout.rows || 24
      const info =
        `debug ${this.mode} ${frame.width}x${frame.height} frame=${_idx} ` +
        `t=${_signal.t.toFixed(2)} beat=${_signal.beat.toFixed(2)} bpm=${_signal.bpm} ` +
        `fps=${this.lastStatusFps.toFixed(1)}/${this.sourceFps}`
      await writeStdout(`\x1b[${row};1H\x1b[2K\x1b[0m${truncate(info, process.stdout.columns || 80)}`)
    }
  }

  async flush(): Promise<void> {
    if (this.hooksInstalled) {
      process.off('exit', this.boundExit)
      process.off('SIGINT', this.boundSig)
      process.off('SIGTERM', this.boundSig)
      this.removeResizeHooks()
      this.hooksInstalled = false
    }
    this.restoreTerminalVisuals()
  }

  get currentMode(): TerminalMode { return this.mode }
  get resolution() { return terminalResolution(this.mode) }
}

function truncate(text: string, width: number): string {
  if (text.length <= width) return text
  return `${text.slice(0, Math.max(0, width - 1))}…`
}

/** Await stdout so backpressure (common on Windows conhost) does not block the event loop. */
function writeStdout(chunk: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      process.stdout.off('drain', onDrain)
      resolve()
    }
    const onDrain = (): void => {
      finish()
    }
    const ok = process.stdout.write(chunk, err => {
      if (err) {
        if (settled) return
        settled = true
        process.stdout.off('drain', onDrain)
        reject(err)
        return
      }
      if (ok) finish()
    })
    if (!ok) process.stdout.once('drain', onDrain)
  })
}
