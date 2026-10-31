import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { RocketInterpolation, RocketTrack } from '@overscan/types'
import { loadWaveform, timelineAudio, type TimelineAudio, type Waveform } from '../engine/audio'
import { formatTime } from '../engine/format'
import { configBindings } from '../engine/graph-model'
import type { PlayerSection } from '../engine/player'
import {
  followTime,
  gridLines,
  INTERPOLATIONS,
  interpolationLabel,
  panView,
  rowsPerSecond,
  timeTicks,
  TrackSampler,
  trackRange,
  zoomView,
  type TimeView,
} from '../engine/timeline'
import { Button, NumberField, Select } from '../ui/kit'
import { useBridge, useFocusSection, useStudio, useStudioStore } from './studio-context'

const LABEL_W = 168
const NO_SECTIONS: readonly PlayerSection[] = []
/** A drag moves a key only after the pointer travels this far, so a click just selects it. */
const DRAG_THRESHOLD_PX = 3
let gestureCounter = 0

/** The key picked for editing: its track and index in the focus section's scene. */
interface KeyRef {
  scenePath: string
  track: string
  index: number
}

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
 * Shift+wheel or horizontal scroll to pan, double-click a section to zoom to it. Keys: click to select
 * (then edit row, value and easing in the toolbar), drag to move, double-click a track to add one,
 * Delete to remove the selected one.
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

  const player = document?.player
  useEffect(() => { setView({ start: 0, end: duration || 1 }) }, [player, duration])
  useEffect(() => {
    if (playing) setView(v => followTime(v, time, duration))
  }, [playing, time, duration])

  useEffect(() => {
    const el = lanesRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => { if (entry) setWidth(Math.max(0, Math.floor(entry.contentRect.width) - LABEL_W)) })
    observer.observe(el)
    return () => { observer.disconnect() }
  }, [player])

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

  const focus = useFocusSection()
  const [keyRef, setKeyRef] = useState<KeyRef | null>(null)
  // A key belongs to one section's scene: moving to another section (or file) drops the selection.
  useEffect(() => { setKeyRef(null) }, [player, focus?.scenePath])
  const selectedNodeId = useStudio(s => s.selectedNodeId)
  // Tracks the selected graph node reads, highlighted in their lanes.
  const selectedTracks = useMemo(() => {
    const node = focus?.scene.graph.nodes.find(n => n.id === selectedNodeId)
    return new Set(node ? configBindings(node.config).flatMap(b => (b.binding.kind === 'track' ? [b.binding.track] : [])) : [])
  }, [focus, selectedNodeId])
  // Audio placement only changes with a new player; config edits keep it.
  const audio = useMemo(() => (document ? timelineAudio(document) : []), [player])
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
        {focus && keyRef && <KeyEditor section={focus} keyRef={keyRef} onDone={() => { setKeyRef(null) }} />}
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
          setKeyRef(null)
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
              <Sections scale={scale} sections={sections} focus={focus} onZoom={s => { zoomTo(s.start, s.end) }} editable={document.kind === 'demo'} />
            </Row>
            {audio.map(clip => (
              <Row key={clip.key} label={<span title={clip.path}>♪ {clip.label}</span>} className="tl-row--audio">
                <AudioLane scale={scale} clip={clip} />
              </Row>
            ))}
            {focus && (
              <TrackLanes
                scale={scale}
                section={focus}
                time={time}
                demo={sections.length > 1}
                highlight={selectedTracks}
                selected={keyRef?.scenePath === focus.scenePath ? keyRef : null}
                onSelect={(track, index) => { setKeyRef({ scenePath: focus.scenePath, track, index }) }}
              />
            )}
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

function Sections({ scale, sections, focus, onZoom, editable }: {
  scale: Scale
  sections: readonly PlayerSection[]
  focus: PlayerSection | undefined
  onZoom: (section: PlayerSection) => void
  /** Demo sections can be resized by dragging their right edge. */
  editable: boolean
}) {
  const store = useStudioStore()
  const selected = useStudio(s => s.selectedSectionId)
  // While an edge is dragged: the section and its new length (applied on release; each change rebuilds the demo).
  const [resize, setResize] = useState<{ index: number; length: number } | null>(null)
  // Blocks stop where the next section starts; the overlap (the transition) is drawn as its own band on top.
  return (
    <>
      {sections.map((section, i) => {
        const next = sections[i + 1]
        const length = resize?.index === i ? resize.length : section.end - section.start
        const end = section.start + length
        const left = scale.x(section.start)
        const right = scale.x(resize?.index === i ? end : Math.min(section.end, next?.start ?? section.end))
        if (right < 0 || left > scale.width) return null
        return (
          <div
            key={`${section.id}-${section.start}`}
            className={`tl-section${section === focus ? ' tl-section--focus' : ''}${section.id === selected ? ' tl-section--selected' : ''}${resize?.index === i ? ' tl-section--resizing' : ''}`}
            style={{ left, width: Math.max(1, right - left) }}
            title={`${section.title}\n${formatTime(section.start)} – ${formatTime(section.end)}${editable ? '\nDrag the right edge to change its length' : ''}`}
            onPointerDown={() => { store.getState().selectSection(section.id) }}
            onDoubleClick={() => { onZoom(section) }}
          >
            {/* The incoming transition band covers the block's start: the name begins after it. */}
            <span className="tl-section__name" style={{ marginLeft: Math.max(0, scale.x(Math.min(end, sections[i - 1]?.end ?? 0)) - left) }}>
              {section.id}{resize?.index === i ? ` · ${length.toFixed(2)}s` : ''}
            </span>
            {editable && (
              <span
                className="tl-section__edge"
                aria-hidden
                onPointerDown={event => {
                  if (event.button !== 0) return
                  event.stopPropagation()
                  const el = event.currentTarget
                  el.setPointerCapture(event.pointerId)
                  const startX = event.clientX
                  const original = section.end - section.start
                  const beat = 60 / section.scene.bpm
                  // The transition overlaps the next section, which should start on a beat: snap the length
                  // without the overlap to whole beats. Alt gives hundredths of a second instead.
                  const overlap = section.transition.type === 'cut' ? 0 : section.transition.duration
                  const lengthAt = (e: PointerEvent): number => {
                    const raw = Math.max(beat + overlap, original + (e.clientX - startX) * ((scale.view.end - scale.view.start) / scale.width))
                    return e.altKey ? Math.round(raw * 100) / 100 : Number((overlap + Math.round((raw - overlap) / beat) * beat).toFixed(4))
                  }
                  const move = (e: PointerEvent): void => { setResize({ index: i, length: lengthAt(e) }) }
                  const up = (e: PointerEvent): void => {
                    el.removeEventListener('pointermove', move)
                    el.removeEventListener('pointerup', up)
                    setResize(null)
                    const next = lengthAt(e)
                    if (Math.abs(next - original) > 1e-6) store.getState().setDemoValue(['sections', i, 'duration'], next)
                  }
                  el.addEventListener('pointermove', move)
                  el.addEventListener('pointerup', up)
                }}
              />
            )}
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

function TrackLanes({ scale, section, time, demo, highlight, selected, onSelect }: {
  scale: Scale
  section: PlayerSection
  time: number
  demo: boolean
  highlight: ReadonlySet<string>
  selected: KeyRef | null
  onSelect: (track: string, index: number) => void
}) {
  const store = useStudioStore()
  const { scene } = section
  const rps = rowsPerSecond(scene.bpm, scene.rowsPerBeat)
  const sampler = useMemo(() => new TrackSampler(scene.tracks), [scene])
  const local = Math.min(section.end, Math.max(section.start, time)) - section.start
  return (
    <>
      <div className="tl-group">
        <span>
          {scene.tracks.length === 0
            ? `No keyframe tracks${demo ? ` in ${section.id}` : ''}`
            : `Tracks${demo ? ` · ${section.id}` : ''} · ${scene.bpm} BPM · ${scene.rowsPerBeat} rows/beat · row ${Math.floor(local * rps)}`}
        </span>
        <button type="button" className="tl-group__add" title="Add a keyframe track" onClick={() => { store.getState().addTrack(section.scenePath, 'track') }}>+ Track</button>
      </div>
      {scene.tracks.map(track => (
        <Row
          key={track.name}
          className={`tl-row--track${highlight.has(track.name) ? ' tl-row--highlight' : ''}`}
          label={
            <TrackLabel
              name={track.name}
              value={formatValue(sampler.valueAt(track.name, local * rps))}
              bound={scene.graph.nodes.filter(n => configBindings(n.config).some(b => b.binding.kind === 'track' && b.binding.track === track.name)).map(n => n.id)}
              onRename={name => { store.getState().renameTrack(section.scenePath, track.name, name) }}
              onRemove={() => { store.getState().removeTrack(section.scenePath, track.name) }}
            />
          }
        >
          <TrackCurve
            scale={scale}
            section={section}
            track={track}
            sampler={sampler}
            rps={rps}
            selectedIndex={selected?.track === track.name ? selected.index : null}
            onSelect={index => { onSelect(track.name, index) }}
          />
        </Row>
      ))}
    </>
  )
}

function TrackCurve({ scale, section, track, sampler, rps, selectedIndex, onSelect }: {
  scale: Scale
  section: PlayerSection
  track: RocketTrack
  sampler: TrackSampler
  rps: number
  selectedIndex: number | null
  onSelect: (index: number) => void
}) {
  const store = useStudioStore()
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
  // While a key is dragged the vertical scale holds still, so the key stays under the pointer.
  const [frozen, setFrozen] = useState<{ min: number; max: number } | null>(null)
  const shown = frozen ?? range
  const y = (v: number): number => (1 - (v - shown.min) / (shown.max - shown.min)) * 100
  const rowAt = (clientX: number, lane: DOMRect): number => (scale.t(clientX - lane.left) - section.start) * rps
  return (
    <div
      className="curve"
      title="Double-click to add a key"
      onDoubleClick={event => {
        const row = Math.max(0, Math.round(rowAt(event.clientX, event.currentTarget.getBoundingClientRect())))
        const before = [...track.keys].reverse().find(k => k.row <= row)
        store.getState().addKey(section.scenePath, track.name, {
          row,
          value: roundValue(sampler.valueAt(track.name, row), shown),
          interpolation: before?.interpolation ?? 'linear',
        })
        const index = [...track.keys, { row }].sort((a, b) => a.row - b.row).findIndex(k => k.row === row)
        onSelect(index)
      }}
    >
      <svg width={scale.width} height="100%" viewBox={`0 0 ${scale.width} 1`} preserveAspectRatio="none">
        <polyline points={curve} vectorEffect="non-scaling-stroke" />
      </svg>
      {track.keys.map((key, index) => {
        const t = section.start + key.row / rps
        if (t < scale.view.start || t > scale.view.end || t > section.end) return null
        return (
          <span
            key={index}
            role="button"
            tabIndex={0}
            className={`curve__key${index === selectedIndex ? ' curve__key--selected' : ''}`}
            style={{ left: scale.x(t), top: `${y(key.value)}%` }}
            aria-label={`${track.name} key at row ${key.row}`}
            title={`row ${key.row} (${formatTime(t)}) = ${formatValue(key.value)} · ${interpolationLabel(key.interpolation)}\nDrag to move · Delete to remove`}
            onDoubleClick={event => { event.stopPropagation() }}
            onKeyDown={event => {
              if (event.key !== 'Delete' && event.key !== 'Backspace') return
              event.preventDefault()
              event.stopPropagation()
              store.getState().removeKey(section.scenePath, track.name, index)
            }}
            onPointerDown={event => {
              if (event.button !== 0) return
              event.stopPropagation()
              onSelect(index)
              const el = event.currentTarget
              el.focus()
              el.setPointerCapture(event.pointerId)
              const lane = el.parentElement!.getBoundingClientRect()
              const startX = event.clientX
              const startY = event.clientY
              const hold = shown
              const gesture = `key:${track.name}:${++gestureCounter}`
              let dragging = false
              const move = (e: PointerEvent): void => {
                if (!dragging && Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD_PX) return
                if (!dragging) setFrozen(hold)
                dragging = true
                const value = hold.max - ((e.clientY - lane.top) / lane.height) * (hold.max - hold.min)
                // Shift keeps the row, so a key can be raised or lowered without slipping in time.
                store.getState().updateKey(section.scenePath, track.name, index, {
                  ...(e.shiftKey ? {} : { row: Math.max(0, rowAt(e.clientX, lane)) }),
                  value: roundValue(value, hold),
                }, gesture)
              }
              const up = (): void => {
                el.removeEventListener('pointermove', move)
                el.removeEventListener('pointerup', up)
                el.removeEventListener('pointercancel', up)
                setFrozen(null)
              }
              el.addEventListener('pointermove', move)
              el.addEventListener('pointerup', up)
              el.addEventListener('pointercancel', up)
            }}
          />
        )
      })}
    </div>
  )
}

/** A track's name and live value; double-click to rename, × to remove (bound settings keep its first value). */
function TrackLabel({ name, value, bound, onRename, onRemove }: {
  name: string
  value: string
  bound: string[]
  onRename: (name: string) => void
  onRemove: () => void
}) {
  const [editing, setEditing] = useState(false)
  const done = useRef(false)
  if (editing) {
    // Enter or leaving the field renames; Escape keeps the name. Only the first of these counts.
    const finish = (value: string | null): void => {
      if (done.current) return
      done.current = true
      setEditing(false)
      if (value !== null) onRename(value)
    }
    return (
      <input
        className="ui-input tl-track-label__input"
        aria-label={`Rename ${name}`}
        defaultValue={name}
        autoFocus
        onFocus={e => { e.currentTarget.select() }}
        onBlur={e => { finish(e.currentTarget.value) }}
        onKeyDown={e => {
          if (e.key === 'Enter') finish(e.currentTarget.value)
          if (e.key === 'Escape') finish(null)
        }}
      />
    )
  }
  return (
    <span
      className="tl-track-label"
      title={`${name}${bound.length ? `\nUsed by ${bound.join(', ')}` : '\nNot used by any node'}\nDouble-click to rename`}
      onDoubleClick={() => { done.current = false; setEditing(true) }}
    >
      <span>{name}</span>
      <span className="tl-track-label__value">{value}</span>
      <button
        type="button"
        className="tl-track-label__remove"
        aria-label={`Remove track ${name}`}
        title="Remove track"
        onClick={() => {
          if (!bound.length || window.confirm(`${bound.join(', ')} follow ${name}. Remove it and keep its first value there?`)) onRemove()
        }}
      >
        ×
      </button>
    </span>
  )
}

/** Rounds a dragged value to about a thousandth of the track's range. */
function roundValue(v: number, range: { min: number; max: number }): number {
  const step = 10 ** Math.floor(Math.log10(Math.max(1e-6, range.max - range.min) / 1000))
  return Number((Math.round(v / step) * step).toFixed(6))
}

/** Row, value and easing of the selected key, plus removing it. */
function KeyEditor({ section, keyRef, onDone }: { section: PlayerSection; keyRef: KeyRef; onDone: () => void }) {
  const store = useStudioStore()
  const key = section.scene.tracks.find(t => t.name === keyRef.track)?.keys[keyRef.index]
  if (!key) return null
  const update = (patch: { row?: number; value?: number; interpolation?: RocketInterpolation }): void => {
    store.getState().updateKey(section.scenePath, keyRef.track, keyRef.index, patch)
  }
  return (
    <span className="tl-key-editor" aria-label={`Key ${keyRef.index + 1} of ${keyRef.track}`}>
      <span className="tl-key-editor__name">{keyRef.track} · key {keyRef.index + 1}</span>
      <label>row <NumberField aria-label="Key row" value={key.row} min={0} step={1} onCommit={row => { update({ row }) }} /></label>
      <label>value <NumberField aria-label="Key value" value={key.value} onCommit={value => { update({ value }) }} /></label>
      <Select
        label="Key easing"
        value={key.interpolation}
        options={INTERPOLATIONS.map(i => ({ value: i, label: interpolationLabel(i) }))}
        onChange={interpolation => { update({ interpolation }) }}
      />
      <Button
        variant="ghost"
        title="Remove this key"
        onClick={() => {
          store.getState().removeKey(section.scenePath, keyRef.track, keyRef.index)
          onDone()
        }}
      >
        Remove
      </Button>
    </span>
  )
}

function formatValue(v: number): string {
  return Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2)
}
