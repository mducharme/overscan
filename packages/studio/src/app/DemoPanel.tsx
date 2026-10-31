import { useEffect, useMemo, useState } from 'react'
import { NODE_SCHEMAS } from '@overscan/nodes/browser'
import type { Demo, DemoTransition } from '@overscan/types'
import { formatTime } from '../engine/format'
import { baseName, resolvePath } from '../engine/paths'
import { INTERPOLATIONS, interpolationLabel } from '../engine/timeline'
import { Button, NumberField, Select } from '../ui/kit'
import { ConfigParams, TextInput } from './Inspector'
import { useBridge, useStudio, useStudioStore } from './studio-context'

const TRANSITIONS: readonly DemoTransition['type'][] = ['cut', 'dissolve', 'wipe-left', 'wipe-right', 'wipe-up', 'wipe-down', 'zoom-out', 'flash', 'iris', 'blinds', 'checker', 'push', 'melt']
const DEFAULT_TRANSITION_S = 0.5

/**
 * The demo file: title, loop and soundtrack, demo-wide modifiers (over every section) and the section
 * list: order, scene, length and the transition into the next one. Edits rebuild the demo.
 */
export function DemoPanel() {
  const store = useStudioStore()
  const filePath = useStudio(s => s.document?.filePath ?? '')
  const text = useStudio(s => (s.document?.kind === 'demo' ? s.document.files[s.document.filePath]?.text : undefined))
  const sections = useStudio(s => s.document?.player.sections)
  const selected = useStudio(s => s.selectedSectionId)
  // Parsed from the edited text, so the panel is current before the rebuild finishes.
  const demo = useMemo(() => {
    try { return text ? JSON.parse(text) as Demo : null } catch { return null }
  }, [text])
  if (!demo || !sections) return <div className="demo demo--empty">This file is a scene; sections and transitions belong to a demo.</div>

  const set = (path: (string | number)[], value: unknown): void => { store.getState().setDemoValue(path, value) }
  const audio = typeof demo.audio === 'string' ? { src: demo.audio } : demo.audio
  const modifiers = demo.modifiers ?? []

  return (
    <section className="demo" aria-label="Demo settings">
      <div className="demo__group">
        <div className="demo__heading">Demo</div>
        <label className="demo__field"><span>Title</span><TextInput label="Demo title" value={demo.title} onCommit={v => { set(['title'], v) }} /></label>
        <label className="demo__field">
          <span>Soundtrack</span>
          <TextInput
            label="Soundtrack"
            value={audio?.src ?? ''}
            placeholder="audio file (mp3, wav, ogg)"
            onCommit={src => { set(['audio'], src === '' ? undefined : audio?.volume !== undefined ? { ...audio, src } : src) }}
          />
        </label>
        {audio && (
          <label className="demo__field">
            <span>Volume</span>
            <NumberField aria-label="Soundtrack volume" value={audio.volume ?? 1} min={0} max={2} step={0.05} onCommit={volume => { set(['audio'], { ...audio, volume }) }} />
          </label>
        )}
        <label className="demo__field demo__field--inline">
          <input type="checkbox" checked={demo.loop === true} onChange={e => { set(['loop'], e.target.checked) }} />
          <span>Loop when played with <code>overscan run</code></span>
        </label>
      </div>

      <div className="demo__group">
        <div className="demo__heading">
          Sections
          <span className="demo__hint">{formatTime(sections.at(-1)?.end ?? 0)} total</span>
        </div>
        <ol className="demo__sections">
          {demo.sections.map((section, i) => {
            const live = sections[i]
            const transition = section.transition ?? { type: 'cut' as const }
            return (
              <li
                key={`${i}:${section.id}`}
                className={`demo__section${selected === section.id ? ' demo__section--selected' : ''}`}
                onClick={event => {
                  if ((event.target as Element).closest('input, select, button')) return
                  store.getState().selectSection(section.id)
                  if (live) store.getState().seek(live.start)
                }}
              >
                <div className="demo__section-head">
                  <span className="demo__index">{i + 1}</span>
                  <TextInput label={`Section ${i + 1} id`} value={section.id} onCommit={id => { if (id && !demo.sections.some(s => s.id === id)) set(['sections', i, 'id'], id) }} />
                  <span className="demo__scene" title={resolvePath(filePath, section.scene)}>{baseName(section.scene)}</span>
                  <span className="demo__buttons">
                    <Button variant="ghost" icon disabled={i === 0} title="Move earlier" aria-label={`Move ${section.id} earlier`} onClick={() => { store.getState().moveSection(i, -1) }}>↑</Button>
                    <Button variant="ghost" icon disabled={i === demo.sections.length - 1} title="Move later" aria-label={`Move ${section.id} later`} onClick={() => { store.getState().moveSection(i, 1) }}>↓</Button>
                    <Button variant="ghost" icon disabled={demo.sections.length <= 1} title="Remove section" aria-label={`Remove ${section.id}`} onClick={() => { store.getState().removeSection(i) }}>×</Button>
                  </span>
                </div>
                <div className="demo__section-body">
                  <label title="Seconds; empty uses the scene's own duration">
                    <span>Length</span>
                    <NumberField
                      aria-label={`${section.id} length`}
                      value={section.duration ?? (live ? live.end - live.start : 0)}
                      min={0.1}
                      step={0.1}
                      onCommit={d => { set(['sections', i, 'duration'], d > 0 ? d : undefined) }}
                    />
                  </label>
                  {i < demo.sections.length - 1 && (
                    <>
                      <label>
                        <span>Into next</span>
                        <Select
                          label={`${section.id} transition`}
                          value={transition.type}
                          options={TRANSITIONS.map(t => ({ value: t, label: t }))}
                          onChange={type => {
                            set(['sections', i, 'transition'], type === 'cut' ? undefined : { ...transition, type, duration: transition.duration ?? DEFAULT_TRANSITION_S })
                          }}
                        />
                      </label>
                      {transition.type !== 'cut' && (
                        <>
                          <label>
                            <span>Over</span>
                            <NumberField aria-label={`${section.id} transition seconds`} value={transition.duration ?? DEFAULT_TRANSITION_S} min={0.05} step={0.05} onCommit={d => { set(['sections', i, 'transition', 'duration'], d) }} />
                          </label>
                          <label>
                            <span>Easing</span>
                            <Select
                              label={`${section.id} transition easing`}
                              value={transition.easing ?? 'linear'}
                              options={INTERPOLATIONS.map(e => ({ value: e, label: interpolationLabel(e) }))}
                              onChange={easing => { set(['sections', i, 'transition', 'easing'], easing) }}
                            />
                          </label>
                          {transition.type === 'flash' && (
                            <label>
                              <span>Colour</span>
                              <input type="color" aria-label={`${section.id} flash colour`} value={transition.flashColor ?? '#ffffff'} onChange={e => { set(['sections', i, 'transition', 'flashColor'], e.target.value) }} />
                            </label>
                          )}
                        </>
                      )}
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
        <AddSection after={Math.max(0, demo.sections.findIndex(s => s.id === selected))} hasSelection={demo.sections.some(s => s.id === selected)} />
      </div>

      <div className="demo__group">
        <div className="demo__heading">
          Over every section
          <span className="demo__hint">demo-wide modifiers</span>
        </div>
        {modifiers.map((modifier, i) => {
          const schema = NODE_SCHEMAS[modifier.impl]
          return (
            <div key={`${i}:${modifier.id}`} className="demo__modifier">
              <div className="demo__section-head">
                <label className="demo__field--inline" title="Turn this modifier off without removing it">
                  <input type="checkbox" checked={modifier.enabled !== false} onChange={e => { set(['modifiers', i, 'enabled'], e.target.checked ? undefined : false) }} />
                  <strong>{modifier.id}</strong>
                </label>
                <span className="demo__hint">{schema?.label ?? modifier.impl}</span>
                <span className="demo__buttons">
                  <Button variant="ghost" icon title="Remove modifier" aria-label={`Remove ${modifier.id}`} onClick={() => { store.getState().removeDemoModifier(i) }}>×</Button>
                </span>
              </div>
              <ConfigParams schema={schema} config={modifier.config} set={key => value => { set(['modifiers', i, 'config', key], value) }} ctx={null} />
            </div>
          )
        })}
        <select
          className="ui-select"
          aria-label="Add a demo-wide modifier"
          value=""
          onChange={e => { if (e.target.value) store.getState().addDemoModifier(e.target.value) }}
        >
          <option value="">+ Add modifier…</option>
          {Object.values(NODE_SCHEMAS).filter(s => s.kind === 'modifier').sort((a, b) => a.label.localeCompare(b.label)).map(s => (
            <option key={s.impl} value={s.impl}>{s.label}</option>
          ))}
        </select>
      </div>
    </section>
  )
}

/** Adds a section showing a scene file of the project, after the selected section (or at the end). */
function AddSection({ after, hasSelection }: { after: number; hasSelection: boolean }) {
  const store = useStudioStore()
  const bridge = useBridge()
  const count = useStudio(s => s.document?.player.sections.length ?? 0)
  const [scenes, setScenes] = useState<{ root: string; files: string[] } | null>(null)
  useEffect(() => {
    let cancelled = false
    bridge.list?.().then(l => { if (!cancelled) setScenes({ root: l.root, files: l.files.filter(f => f.endsWith('.scene.json')) }) }, () => {})
    return () => { cancelled = true }
  }, [bridge])
  if (!scenes) return null
  const index = hasSelection ? after : count - 1
  return (
    <select
      className="ui-select"
      aria-label="Add a section"
      value=""
      onChange={e => { if (e.target.value) store.getState().addSection(index, e.target.value) }}
    >
      <option value="">{hasSelection ? '+ Add section after the selected one…' : '+ Add section at the end…'}</option>
      {scenes.files.map(f => <option key={f} value={f}>{f.slice(scenes.root.length + 1)}</option>)}
    </select>
  )
}
