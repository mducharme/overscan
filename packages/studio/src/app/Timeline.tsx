import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { RocketTrack } from '@overscan/types'
import { loadWaveform, timelineAudio, type TimelineAudio, type Waveform } from '../engine/audio'
import { formatTime } from '../engine/format'
import type { PlayerSection } from '../engine/player'
import {
  followTime,
  gridLines,
  interpolationLabel,
  panView,
  rowsPerSecond,
  timeTicks,
  TrackSampler,
  trackRange,
  zoomView,
  type TimeView,
} from '../engine/timeline'
import { Button } from '../ui/kit'
import { useBridge, useStudio, useStudioStore } from './studio-context'

const LABEL_W = 168
const NO_SECTIONS: readonly PlayerSection[] = []

/** Maps times to x pixels in the lane area. */
interface Scale {
  view: TimeView
  width: number
  x(t: number): number
  t(x: number): number
}

function makeScale(view: TimeView, width: number): Scale {
  const k = width / Math.max(1e-6, view.end - view.start)
  return { view, width, x: t => (t - view.start) * k, t: x => view.start + x / k }
}

/**
 * The timeline: ruler with the bar/beat grid, demo sections and transitions, audio waveforms and the
 * rocket tracks of the section under the playhead. Click or drag to seek; ⌘/Ctrl+wheel or pinch to zoom,
 * Shift+wheel or horizontal scroll to pan, double-click a section to zoom to it.
 */
export function Timeline() {
  const store = useStudioStore()
  const document = useStudio(s => s.document)
  const sections = useStudio(s => s.document?.player.sections ?? NO_SECTIONS)
  const duration = useStudio(s => s.document?.player.duration ?? 0)
  const time = useStudio(s => s.time)
  const playing = useStudio(s => s.playing)
  const lanesRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [view, setView] = useState<TimeView>({ start: 0, end: 1 })

  useEffect(() => { setView({ start: 0, end: duration || 1 }) }, [document, duration])
  useEffect(() => {
    if (playing) setView(v => followTime(v, time, duration))
  }, [playing, time, duration])

  useEffect(() => {
    const el = lanesRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => { if (entry) setWidth(Math.max(0, Math.floor(entry.contentRect.width) - LABEL_W)) })
    observer.observe(el)
    return () => { observer.disconnect() }
  }, [document])

  // Wheel needs a non-passive listener to stop the page zooming on pinch.
  const viewRef = useRef(view)
  viewRef.current = view
  useEffect(() => {
    const el = lanesRef.current
    if (!el || width === 0) return
    const onWheel = (event: WheelEvent): void => {
      const v = viewRef.current
      const scale = makeScale(v, width)
      const x = event.clientX - el.getBoundingClientRect().left - LABEL_W
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault()
        setView(zoomView(v, Math.exp(event.deltaY * 0.01), scale.t(Math.max(0, x)), duration))
      } else if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        event.preventDefault()
        const px = event.shiftKey ? event.deltaY || event.deltaX : event.deltaX
        setView(panView(v, scale.t(px) - v.start, duration))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => { el.removeEventListener('wheel', onWheel) }
  }, [width, duration])

  const focus = useMemo(() => [...sections].reverse().find(s => time >= s.start && time < s.end) ?? sections.at(-1), [sections, time])
  const audio = useMemo(() => (document ? timelineAudio(document) : []), [document])
  const scale = makeScale(view, width)
  // During a transition overlap the incoming section owns the grid, so beat lines never double up.
  const spans = useMemo(() => sections.map((s, i) => ({ start: s.start, end: Math.min(s.end, sections[i + 1]?.start ?? s.end), bpm: s.scene.bpm })), [sections])
  const grid = useMemo(() => (width > 0 ? gridLines(view, width, spans) : []), [view, width, spans])

  if (!document || duration <= 0) return null

  const seekAt = (clientX: number): void => {
    const rect = lanesRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = clientX - rect.left - LABEL_W
    if (x >= 0) store.getState().seek(scale.t(x))
  }
  const zoomTo = (from: number, to: number): void => {
    const pad = (to - from) * 0.02
    setView(zoomView({ start: from - pad, end: to + pad }, 1, from, duration))
  }

  return (
    <section className="timeline" aria-label="Timeline">
      <div className="timeline__toolbar">
        <span className="timeline__title">Timeline</span>
        <span className="timeline__view">{formatTime(view.start)} – {formatTime(view.end)}</span>
        <span className="timeline__spacer" />
        <Button variant="ghost" title="Show the whole timeline" onClick={() => { setView({ start: 0, end: duration }) }}>Fit all</Button>
        {focus && sections.length > 1 && (
          <Button variant="ghost" title="Zoom to the section under the playhead (or double-click a section)" onClick={() => { zoomTo(focus.start, focus.end) }}>
            Fit {focus.id}
          </Button>
        )}
      </div>
      <div
        ref={lanesRef}
        className="timeline__lanes"
        onPointerDown={event => {
          if (event.button !== 0 || event.clientX - event.currentTarget.getBoundingClientRect().left < LABEL_W) return
          event.currentTarget.setPointerCapture(event.pointerId)
          seekAt(event.clientX)
        }}
        onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) seekAt(event.clientX) }}
      >
        {width > 0 && (
          <>
            <svg className="timeline__grid" width={width} style={{ left: LABEL_W }} aria-hidden>
              {grid.map(line => (
                <line key={line.t} x1={scale.x(line.t)} x2={scale.x(line.t)} y1="0" y2="100%" className={`grid-${line.kind}`} />
              ))}
            </svg>
            <Row label={sections.length > 1 ? `${sections.length} sections` : 'Scene'} className="tl-row--ruler">
              <Ruler scale={scale} grid={grid} />
            </Row>
            <Row label="Sections" className="tl-row--sections">
              <Sections scale={scale} sections={sections} focus={focus} onZoom={s => { zoomTo(s.start, s.end) }} />
            </Row>
            {audio.map(clip => (
              <Row key={clip.key} label={<span title={clip.path}>♪ {clip.label}</span>} className="tl-row--audio">
                <AudioLane scale={scale} clip={clip} />
              </Row>
            ))}
            {focus && <TrackLanes scale={scale} section={focus} time={time} demo={sections.length > 1} />}
            <div className="timeline__playhead" style={{ left: LABEL_W + scale.x(time) }} hidden={time < view.start || time > view.end} />
          </>
        )}
      </div>
    </section>
  )
}

function Row({ label, className, children }: { label: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div className={`tl-row ${className ?? ''}`}>
      <div className="tl-row__label">{label}</div>
      <div className="tl-row__lane">{children}</div>
    </div>
  )
}

function Ruler({ scale, grid }: { scale: Scale; grid: ReturnType<typeof gridLines> }) {
  return (
    <svg width={scale.width} height="100%" className="ruler">
      {timeTicks(scale.view, scale.width).map(t => (
        <g key={t} transform={`translate(${scale.x(t)},0)`}>
          <line y1="14" y2="24" />
          <text x="3" y="11">{formatTime(t)}</text>
        </g>
      ))}
      {grid.filter(line => line.bar !== undefined).map(line => (
        <text key={`bar-${line.t}`} className="ruler__bar" x={scale.x(line.t) + 3} y="23">{line.bar}</text>
      ))}
    </svg>
  )
}

function Sections({ scale, sections, focus, onZoom }: { scale: Scale; sections: readonly PlayerSection[]; focus: PlayerSection | undefined; onZoom: (section: PlayerSection) => void }) {
  // Blocks stop where the next section starts; the overlap (the transition) is drawn as its own band on top.
  return (
    <>
      {sections.map((section, i) => {
        const next = sections[i + 1]
        const left = scale.x(section.start)
        const right = scale.x(Math.min(section.end, next?.start ?? section.end))
        if (right < 0 || left > scale.width) return null
        return (
          <div
            key={`${section.id}-${section.start}`}
            className={`tl-section${section === focus ? ' tl-section--focus' : ''}`}
            style={{ left, width: Math.max(1, right - left) }}
            title={`${section.title}\n${formatTime(section.start)} – ${formatTime(section.end)}`}
            onDoubleClick={() => { onZoom(section) }}
          >
            <span className="tl-section__name">{section.id}</span>
          </div>
        )
      })}
      {sections.map((section, i) => {
        const next = sections[i + 1]
        const { type, duration } = section.transition
        if (!next || type === 'cut' || duration <= 0) return null
        const from = Math.min(next.start, section.end - duration)
        const left = scale.x(from)
        const right = scale.x(section.end)
        if (right < 0 || left > scale.width) return null
        return (
          <div
            key={`t-${section.id}-${section.start}`}
            className="tl-transition"
            style={{ left, width: Math.max(2, right - left) }}
            title={`${type} ${duration}s: ${section.id} → ${next.id}`}
          >
            {right - left > 40 && type}
          </div>
        )
      })}
    </>
  )
}

function AudioLane({ scale, clip }: { scale: Scale; clip: TimelineAudio }) {
  const bridge = useBridge()
  const [waveform, setWaveform] = useState<Waveform | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setWaveform(null)
    setError(null)
    loadWaveform(bridge, clip.path).then(
      w => { if (!cancelled) setWaveform(w) },
      (e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) },
    )
    return () => { cancelled = true }
  }, [bridge, clip.path])

  const path = useMemo(() => {
    if (!waveform) return ''
    const from = Math.max(0, Math.floor(scale.x(clip.start)))
    const to = Math.min(scale.width, Math.ceil(scale.x(Math.min(clip.end, clip.start + waveform.duration / clip.rate))))
    // Normalised to the file's peak (up to 8× gain) so quiet files still read.
    const gain = 0.48 / Math.max(waveform.peak, 1 / 8)
    const top: string[] = []
    const bottom: string[] = []
    for (let x = from; x < to; x++) {
      // Audio seconds covered by this pixel column.
      const a = (scale.t(x) - clip.start) * clip.rate
      const b = (scale.t(x + 1) - clip.start) * clip.rate
      const i0 = Math.max(0, Math.floor(a * waveform.resolution))
      const i1 = Math.min(waveform.peaks.length / 2, Math.max(i0 + 1, Math.ceil(b * waveform.resolution)))
      let lo = 0
      let hi = 0
      for (let i = i0; i < i1; i++) {
        lo = Math.min(lo, waveform.peaks[i * 2]!)
        hi = Math.max(hi, waveform.peaks[i * 2 + 1]!)
      }
      top.push(`${x},${(0.5 - hi * gain).toFixed(3)}`)
      bottom.push(`${x},${(0.5 - lo * gain).toFixed(3)}`)
    }
    return top.length ? `M${top.join('L')}L${bottom.reverse().join('L')}Z` : ''
  }, [waveform, scale.view.start, scale.view.end, scale.width, clip])

  if (error) return <span className="tl-lane-note tl-lane-note--error">Could not decode audio: {error}</span>
  if (!waveform) return <span className="tl-lane-note">Decoding audio…</span>
  return (
    <svg width={scale.width} height="100%" viewBox={`0 0 ${scale.width} 1`} preserveAspectRatio="none" className="waveform">
      <path d={path} />
    </svg>
  )
}

const CURVE_STEP_PX = 2

function TrackLanes({ scale, section, time, demo }: { scale: Scale; section: PlayerSection; time: number; demo: boolean }) {
  const { scene } = section
  const rps = rowsPerSecond(scene.bpm, scene.rowsPerBeat)
  const sampler = useMemo(() => new TrackSampler(scene.tracks), [scene])
  const local = Math.min(section.end, Math.max(section.start, time)) - section.start
  return (
    <>
      <div className="tl-group">
        {scene.tracks.length === 0
          ? `No keyframe tracks${demo ? ` in ${section.id}` : ''}`
          : `Tracks${demo ? ` · ${section.id}` : ''} · ${scene.bpm} BPM · ${scene.rowsPerBeat} rows/beat · row ${Math.floor(local * rps)}`}
      </div>
      {scene.tracks.map(track => (
        <Row
          key={track.name}
          className="tl-row--track"
          label={
            <span className="tl-track-label" title={track.name}>
              <span>{track.name}</span>
              <span className="tl-track-label__value">{formatValue(sampler.valueAt(track.name, local * rps))}</span>
            </span>
          }
        >
          <TrackCurve scale={scale} section={section} track={track} sampler={sampler} rps={rps} />
        </Row>
      ))}
    </>
  )
}

function TrackCurve({ scale, section, track, sampler, rps }: { scale: Scale; section: PlayerSection; track: RocketTrack; sampler: TrackSampler; rps: number }) {
  const { curve, range } = useMemo(() => {
    const from = Math.max(0, scale.x(section.start))
    const to = Math.min(scale.width, scale.x(section.end))
    const xs: number[] = []
    for (let x = from; x < to; x += CURVE_STEP_PX) xs.push(x)
    if (to > from) xs.push(to)
    const values = xs.map(x => sampler.valueAt(track.name, (scale.t(x) - section.start) * rps))
    const range = trackRange(track, values)
    const y = (v: number): number => 1 - (v - range.min) / (range.max - range.min)
    return { curve: xs.map((x, i) => `${x.toFixed(1)},${y(values[i]!).toFixed(4)}`).join(' '), range }
  }, [scale.view.start, scale.view.end, scale.width, section, track, sampler, rps])
  const y = (v: number): number => (1 - (v - range.min) / (range.max - range.min)) * 100
  return (
    <div className="curve">
      <svg width={scale.width} height="100%" viewBox={`0 0 ${scale.width} 1`} preserveAspectRatio="none">
        <polyline points={curve} vectorEffect="non-scaling-stroke" />
      </svg>
      {track.keys.map(key => {
        const t = section.start + key.row / rps
        if (t < scale.view.start || t > scale.view.end || t > section.end) return null
        return (
          <span
            key={key.row}
            className="curve__key"
            style={{ left: scale.x(t), top: `${y(key.value)}%` }}
            title={`row ${key.row} (${formatTime(t)}) = ${formatValue(key.value)} · ${interpolationLabel(key.interpolation)}`}
          />
        )
      })}
    </div>
  )
}

function formatValue(v: number): string {
  return Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2)
}
