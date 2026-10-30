import { useRef } from 'react'
import type { PlayerSection } from '../engine/player'
import { useStudio } from './studio-context'

// Selectors must return stable values: a fresh [] each time would re-render forever.
const NO_SECTIONS: readonly PlayerSection[] = []

/** Timeline strip: one block per section, a playhead, and click-or-drag to seek. */
export function ScrubBar() {
  const sections = useStudio(s => s.document?.player.sections ?? NO_SECTIONS)
  const duration = useStudio(s => s.document?.player.duration ?? 0)
  const time = useStudio(s => s.time)
  const seek = useStudio(s => s.seek)
  const ref = useRef<HTMLDivElement>(null)
  if (duration <= 0) return null

  const seekToPointer = (clientX: number): void => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    seek(((clientX - rect.left) / rect.width) * duration)
  }
  const active = [...sections].reverse().find(s => time >= s.start && time < s.end)

  return (
    <div
      ref={ref}
      className="scrub"
      role="slider"
      aria-label="Timeline"
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={time}
      tabIndex={0}
      onPointerDown={event => {
        event.currentTarget.setPointerCapture(event.pointerId)
        seekToPointer(event.clientX)
      }}
      onPointerMove={event => { if (event.buttons & 1) seekToPointer(event.clientX) }}
    >
      {sections.map(section => (
        <div
          key={`${section.id}-${section.start}`}
          className={`scrub__section${section === active ? ' scrub__section--active' : ''}`}
          style={{ left: `${(section.start / duration) * 100}%`, width: `${((section.end - section.start) / duration) * 100}%` }}
          title={`${section.title} · ${section.start.toFixed(1)}–${section.end.toFixed(1)} s`}
        >
          {sections.length > 1 && <span>{section.id}</span>}
        </div>
      ))}
      <div className="scrub__playhead" style={{ left: `${(time / duration) * 100}%` }} />
    </div>
  )
}
