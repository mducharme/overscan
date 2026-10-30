import type { AudioClip } from '@overscan/types'
import type { Bridge } from './bridge'
import type { StudioDocument } from './document'
import { baseName, isUrl, resolvePath } from './paths'
import { waveformPeaks } from './timeline'

/** One audio file placed on the timeline: the demo soundtrack, or a scene's audio during its section. */
export interface TimelineAudio {
  key: string
  label: string
  /** Resolved file path (or URL). */
  path: string
  /** Global time the clip's 0 s plays at. */
  start: number
  /** Global time it stops at. */
  end: number
  volume: number
  rate: number
}

function clipSource(audio: AudioClip | string): { src: string; volume: number; rate: number } {
  return typeof audio === 'string'
    ? { src: audio, volume: 1, rate: 1 }
    : { src: audio.src, volume: audio.volume ?? 1, rate: audio.pitch ?? 1 }
}

function resolveSource(basePath: string, src: string): string {
  return isUrl(src) ? src : resolvePath(basePath, src)
}

/** Same placement as `overscan run`: demo audio spans the demo, scene audio restarts with its section. */
export function timelineAudio(document: StudioDocument): TimelineAudio[] {
  const clips: TimelineAudio[] = []
  const { player } = document
  if (document.demo?.audio) {
    const { src, volume, rate } = clipSource(document.demo.audio)
    clips.push({ key: 'demo', label: baseName(src), path: resolveSource(document.filePath, src), start: 0, end: player.duration, volume, rate })
  }
  for (const section of player.sections) {
    if (!section.scene.audio) continue
    const { src, volume, rate } = clipSource(section.scene.audio)
    const label = player.sections.length > 1 ? `${section.id} · ${baseName(src)}` : baseName(src)
    clips.push({ key: `section:${section.id}:${section.start}`, label, path: resolveSource(section.scenePath, src), start: section.start, end: section.end, volume, rate })
  }
  return clips
}

/** Decoded overview of one audio file: per-bucket min/max of the first channel. */
export interface Waveform {
  duration: number
  /** Buckets per second of audio. */
  resolution: number
  peaks: Float32Array
  /** Loudest absolute sample, so quiet files can be drawn at a readable size. */
  peak: number
}

const WAVEFORM_RESOLUTION = 200
const waveforms = new Map<string, Promise<Waveform>>()

/** Decodes a file once per session (cached by path) into a waveform overview. */
export function loadWaveform(bridge: Bridge, path: string): Promise<Waveform> {
  let pending = waveforms.get(path)
  if (!pending) {
    pending = (async () => {
      const bytes = isUrl(path) ? new Uint8Array(await (await fetch(path)).arrayBuffer()) : await bridge.readBinary(path)
      const context = new OfflineAudioContext(1, 1, 44_100)
      const buffer = await context.decodeAudioData(bytes.slice().buffer)
      const buckets = Math.max(1, Math.ceil(buffer.duration * WAVEFORM_RESOLUTION))
      const peaks = waveformPeaks(buffer.getChannelData(0), buckets)
      let peak = 0
      for (const v of peaks) peak = Math.max(peak, Math.abs(v))
      return { duration: buffer.duration, resolution: buckets / buffer.duration, peaks, peak }
    })()
    pending.catch(() => { waveforms.delete(path) })
    waveforms.set(path, pending)
  }
  return pending
}

/** Seconds of drift tolerated before re-seeking a playing element. */
const MAX_DRIFT = 0.12

/**
 * Plays a document's audio through <audio> elements, following the studio clock: each `sync` starts,
 * stops, seeks or re-rates the elements so they match the playhead.
 */
interface ClipElement {
  clip: TimelineAudio
  el: HTMLAudioElement
  failed: boolean
  /** play() was called and has not settled yet (the element still reports paused meanwhile). */
  starting: boolean
}

export class AudioPlayback {
  private readonly elements = new Map<string, ClipElement>()
  /** The browser refused to start audio without a user gesture; retry after the next one. */
  private blocked = false
  private readonly unblock = (): void => { this.blocked = false }

  constructor(clips: readonly TimelineAudio[], mediaUrl: (path: string) => string) {
    for (const clip of clips) {
      const el = new Audio(isUrl(clip.path) ? clip.path : mediaUrl(clip.path))
      el.preload = 'auto'
      el.preservesPitch = false
      el.volume = Math.min(1, Math.max(0, clip.volume))
      const entry: ClipElement = { clip, el, failed: false, starting: false }
      el.addEventListener('error', () => { entry.failed = true })
      this.elements.set(clip.key, entry)
    }
    window.addEventListener('pointerdown', this.unblock, true)
    window.addEventListener('keydown', this.unblock, true)
  }

  /** True while the browser's autoplay policy is holding audio back. */
  get isBlocked(): boolean {
    return this.blocked
  }

  sync(time: number, playing: boolean, rate: number, muted: boolean): void {
    for (const entry of this.elements.values()) {
      const { clip, el } = entry
      if (entry.failed || entry.starting) continue
      const local = (time - clip.start) * clip.rate
      const audible = playing && time >= clip.start && time < clip.end && (!Number.isFinite(el.duration) || local < el.duration)
      el.muted = muted
      if (!audible) {
        if (!el.paused) el.pause()
        continue
      }
      el.playbackRate = Math.min(4, Math.max(0.25, rate * clip.rate))
      if (!el.paused) {
        if (Math.abs(el.currentTime - local) > MAX_DRIFT * Math.max(1, rate)) el.currentTime = local
        continue
      }
      if (this.blocked) continue
      el.currentTime = local
      entry.starting = true
      el.play().then(
        () => { entry.starting = false },
        (error: unknown) => {
          entry.starting = false
          if (error instanceof DOMException && error.name === 'NotAllowedError') this.blocked = true
          else entry.failed = true
        },
      )
    }
  }

  destroy(): void {
    window.removeEventListener('pointerdown', this.unblock, true)
    window.removeEventListener('keydown', this.unblock, true)
    for (const { el } of this.elements.values()) {
      el.pause()
      el.removeAttribute('src')
      el.load()
    }
    this.elements.clear()
  }
}
