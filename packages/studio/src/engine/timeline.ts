import type { RocketInterpolation, RocketTrack } from '@overscan/types'
import { RocketTimeline } from '@overscan/core/browser'

/** The visible stretch of the timeline, in seconds. */
export interface TimeView {
  start: number
  end: number
}

export const MIN_VIEW_SPAN = 0.25

/** Keeps a view inside [0, duration] and at least MIN_VIEW_SPAN wide (or the whole document if shorter). */
export function clampView(view: TimeView, duration: number): TimeView {
  const span = Math.min(duration, Math.max(Math.min(MIN_VIEW_SPAN, duration), view.end - view.start))
  const start = Math.min(Math.max(0, view.start), duration - span)
  return { start, end: start + span }
}

/** Zooms by `factor` (<1 zooms in) keeping time `anchor` at the same screen position. */
export function zoomView(view: TimeView, factor: number, anchor: number, duration: number): TimeView {
  return clampView({ start: anchor - (anchor - view.start) * factor, end: anchor + (view.end - anchor) * factor }, duration)
}

export function panView(view: TimeView, delta: number, duration: number): TimeView {
  return clampView({ start: view.start + delta, end: view.end + delta }, duration)
}

/** Scrolls the view a page forward/back when `time` leaves it (used while playing). */
export function followTime(view: TimeView, time: number, duration: number): TimeView {
  if (time >= view.start && time <= view.end) return view
  const span = view.end - view.start
  return clampView({ start: time - span * 0.05, end: time + span * 0.95 }, duration)
}

/** A stretch with its own tempo: one per demo section, or the whole scene. */
export interface TempoSpan {
  start: number
  end: number
  bpm: number
  beatsPerBar?: number
}

export interface GridLine {
  t: number
  kind: 'bar' | 'beat'
  /** 1-based bar number within its span, on labelled bar lines. */
  bar?: number
}

const MIN_LINE_GAP_PX = 6
const MIN_LABEL_GAP_PX = 36

/**
 * Bar and beat lines for the visible view. Beats are dropped when they would be closer than a few
 * pixels apart, and bars thinned (every 2nd, 4th, …) the same way.
 */
export function gridLines(view: TimeView, widthPx: number, spans: readonly TempoSpan[]): GridLine[] {
  const pxPerSecond = widthPx / Math.max(1e-6, view.end - view.start)
  const lines: GridLine[] = []
  for (const span of spans) {
    if (span.bpm <= 0 || span.end <= view.start || span.start >= view.end) continue
    const beat = 60 / span.bpm
    const beatsPerBar = span.beatsPerBar ?? 4
    const beatPx = beat * pxPerSecond
    const barPx = beatPx * beatsPerBar
    let barStride = 1
    while (barPx * barStride < MIN_LINE_GAP_PX) barStride *= 2
    let labelStride = barStride
    while (barPx * labelStride < MIN_LABEL_GAP_PX) labelStride *= 2
    const first = Math.max(0, Math.floor((view.start - span.start) / beat))
    const last = Math.ceil((Math.min(view.end, span.end) - span.start) / beat)
    for (let i = first; i <= last; i++) {
      const t = span.start + i * beat
      if (t < span.start || t >= span.end || t < view.start || t > view.end) continue
      if (i % beatsPerBar === 0) {
        const barIndex = i / beatsPerBar
        if (barIndex % barStride !== 0) continue
        lines.push(barIndex % labelStride === 0 ? { t, kind: 'bar', bar: barIndex + 1 } : { t, kind: 'bar' })
      } else if (beatPx >= MIN_LINE_GAP_PX) {
        lines.push({ t, kind: 'beat' })
      }
    }
  }
  return lines
}

/** Ruler labels at a "nice" step (0.1 s … 5 min) leaving at least `minGapPx` between labels. */
export function timeTicks(view: TimeView, widthPx: number, minGapPx = 64): number[] {
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]
  const pxPerSecond = widthPx / Math.max(1e-6, view.end - view.start)
  const step = steps.find(s => s * pxPerSecond >= minGapPx) ?? 600
  const ticks: number[] = []
  for (let t = Math.ceil(view.start / step) * step; t <= view.end + 1e-9; t += step) ticks.push(Math.round(t * 1000) / 1000)
  return ticks
}

/** Rocket rows per second for a scene's tempo. */
export function rowsPerSecond(bpm: number, rowsPerBeat: number): number {
  return (bpm / 60) * rowsPerBeat
}

/** Evaluates rocket tracks exactly like the engine does (same interpolation code). */
export class TrackSampler {
  private readonly timelines = new Map<string, RocketTimeline>()

  constructor(tracks: readonly RocketTrack[]) {
    for (const track of tracks) {
      const timeline = new RocketTimeline()
      timeline.load([track])
      this.timelines.set(track.name, timeline)
    }
  }

  valueAt(name: string, row: number): number {
    return this.timelines.get(name)?.resolve(row)[name] ?? 0
  }

  /** `count` evenly spaced values between rows `fromRow` and `toRow` (inclusive). */
  sample(name: string, fromRow: number, toRow: number, count: number): number[] {
    const values: number[] = []
    for (let i = 0; i < count; i++) values.push(this.valueAt(name, fromRow + ((toRow - fromRow) * i) / Math.max(1, count - 1)))
    return values
  }
}

/** Value range a lane should show: the keys' min/max, padded so flat tracks still get a visible line. */
export function trackRange(track: RocketTrack, samples: readonly number[] = []): { min: number; max: number } {
  let min = Infinity
  let max = -Infinity
  for (const v of [...track.keys.map(k => k.value), ...samples]) {
    if (v < min) min = v
    if (v > max) max = v
  }
  if (!Number.isFinite(min)) return { min: -1, max: 1 }
  const pad = max - min < 1e-9 ? Math.max(1, Math.abs(min)) * 0.5 : (max - min) * 0.08
  return { min: min - pad, max: max + pad }
}

/** Short label for an interpolation, for key tooltips. */
export function interpolationLabel(mode: RocketInterpolation): string {
  return mode === 'step' ? 'hold' : mode
}

/** Min/max pairs for `buckets` equal slices of one channel (interleaved: [min0, max0, min1, max1, …]). */
export function waveformPeaks(samples: Float32Array, buckets: number): Float32Array {
  const peaks = new Float32Array(buckets * 2)
  const per = samples.length / buckets
  for (let b = 0; b < buckets; b++) {
    const from = Math.floor(b * per)
    const to = Math.max(from + 1, Math.floor((b + 1) * per))
    let lo = 0
    let hi = 0
    for (let i = from; i < to && i < samples.length; i++) {
      const v = samples[i]!
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    peaks[b * 2] = lo
    peaks[b * 2 + 1] = hi
  }
  return peaks
}
