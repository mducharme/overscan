import type { Clock, ClockOptions } from '@overscan/types'

export interface TimeSource {
  nowMs(): number
}

export class PlaybackClock implements Clock {
  private anchorNowMs: number
  private anchorTime = 0
  private rate = 1
  private paused = false
  private loop?: [number, number]

  constructor(
    private readonly source: TimeSource,
    opts: ClockOptions = {},
  ) {
    this.anchorNowMs = source.nowMs()
    this.anchorTime = opts.seek ?? 0
    this.rate = opts.rate ?? 1
    if (opts.loop !== undefined) this.loop = opts.loop
  }

  currentTime(): number {
    const now = this.paused ? this.anchorNowMs : this.source.nowMs()
    const elapsedSec = Math.max(0, (now - this.anchorNowMs) / 1000)
    const t = this.anchorTime + elapsedSec * this.rate
    return this.applyLoop(t)
  }

  isPaused(): boolean {
    return this.paused
  }

  getRate(): number {
    return this.rate
  }

  seek(t: number): void {
    this.anchorTime = this.applyLoop(t)
    this.anchorNowMs = this.source.nowMs()
  }

  pause(): void {
    if (this.paused) return
    this.anchorTime = this.currentTime()
    this.anchorNowMs = this.source.nowMs()
    this.paused = true
  }

  play(): void {
    if (!this.paused) return
    this.anchorNowMs = this.source.nowMs()
    this.paused = false
  }

  setRate(rate: number): void {
    this.anchorTime = this.currentTime()
    this.anchorNowMs = this.source.nowMs()
    this.rate = rate
  }

  private applyLoop(t: number): number {
    if (!this.loop) return t
    const [start, end] = this.loop
    if (!(end > start)) return t
    const span = end - start
    if (t < start) return start
    return start + ((((t - start) % span) + span) % span)
  }
}

export function createNodeTimeSource(): TimeSource {
  return {
    nowMs() {
      if (typeof process !== 'undefined' && typeof process.hrtime?.bigint === 'function') {
        return Number(process.hrtime.bigint()) / 1e6
      }
      return Date.now()
    },
  }
}

export function createBrowserTimeSource(): TimeSource {
  return {
    nowMs() {
      return typeof performance !== 'undefined' ? performance.now() : Date.now()
    },
  }
}
