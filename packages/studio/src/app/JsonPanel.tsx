import { useEffect, useMemo, useRef, useState } from 'react'
import { baseName } from '../engine/paths'
import { Select } from '../ui/kit'
import { useFocusSection, useStudio, useStudioStore } from './studio-context'

/** Typing pauses this long before the text is applied to the preview. */
const APPLY_DELAY_MS = 400

/**
 * The raw JSON of the scene under the playhead (or any file of the document). Edits apply live once
 * they are valid; until then the preview keeps the last valid version and the problem is shown.
 */
export function JsonPanel() {
  const store = useStudioStore()
  const focus = useFocusSection()
  const files = useStudio(s => s.document?.files)
  const demoPath = useStudio(s => (s.document?.kind === 'demo' ? s.document.filePath : null))
  const selectedNodeId = useStudio(s => s.selectedNodeId)
  // The file follows the playhead until one is picked by hand.
  const [chosen, setChosen] = useState<string | null>(null)
  const path = (chosen && files?.[chosen] ? chosen : focus?.scenePath) ?? null
  const text = (path && files?.[path]?.text) ?? ''

  const [draft, setDraft] = useState(text)
  const [error, setError] = useState<string | null>(null)
  // The text the draft was last in step with: outside edits replace the draft only if it has no edits of its own.
  const synced = useRef({ path, text })
  const pending = useRef<number | undefined>(undefined)
  const area = useRef<HTMLTextAreaElement>(null)
  const gutter = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const was = synced.current
    if (was.path !== path || draft === was.text) {
      setDraft(text)
      setError(null)
    }
    synced.current = { path, text }
    // Only outside changes matter here; the draft is read at the moment they arrive.
  }, [path, text])

  const apply = (value: string): void => {
    window.clearTimeout(pending.current)
    pending.current = undefined
    if (!path || value === synced.current.text) {
      setError(null)
      return
    }
    const problem = store.getState().setFileText(path, value)
    setError(problem === null ? null : describe(problem, value))
    if (problem === null) synced.current = { path, text: value }
  }
  const schedule = (value: string): void => {
    window.clearTimeout(pending.current)
    pending.current = window.setTimeout(() => { apply(value) }, APPLY_DELAY_MS)
  }
  useEffect(() => () => { window.clearTimeout(pending.current) }, [])

  // Selecting a node in the graph scrolls its JSON into view (unless the editor is being typed in).
  useEffect(() => {
    const el = area.current
    if (!el || !selectedNodeId || document.activeElement === el) return
    const at = draft.indexOf(`"id": ${JSON.stringify(selectedNodeId)}`)
    if (at < 0) return
    const line = draft.slice(0, at).split('\n').length - 1
    el.scrollTop = Math.max(0, line * lineHeight(el) - el.clientHeight / 3)
    el.setSelectionRange(at, at)
  }, [selectedNodeId, path])

  const lines = useMemo(() => draft.split('\n').length, [draft])
  const options = useMemo(() => {
    const paths = Object.keys(files ?? {})
    const ordered = demoPath ? [demoPath, ...paths.filter(p => p !== demoPath)] : paths
    return ordered.map(p => ({ value: p, label: p === demoPath ? `${baseName(p)} (demo)` : baseName(p) }))
  }, [files, demoPath])

  if (!path) return null
  const dirty = files?.[path] ? files[path].text !== files[path].savedText : false
  return (
    <section className="json" aria-label={`JSON of ${baseName(path)}`}>
      <header className="json__header">
        {options.length > 1
          ? <Select label="File" value={path} options={options} onChange={p => { apply(draft); setChosen(p) }} />
          : <span className="json__file">{baseName(path)}</span>}
        {chosen && chosen !== focus?.scenePath && (
          <button type="button" className="json__follow" title="Show the scene under the playhead" onClick={() => { apply(draft); setChosen(null) }}>Follow playhead</button>
        )}
        <span className={`json__status${error ? ' json__status--error' : ''}`}>
          {error ? 'Not applied' : draft !== synced.current.text ? 'Editing…' : dirty ? 'Unsaved' : 'Saved'}
        </span>
      </header>
      <div className="json__editor">
        <div ref={gutter} className="json__gutter" aria-hidden>
          {Array.from({ length: lines }, (_, i) => <div key={i}>{i + 1}</div>)}
        </div>
        <textarea
          ref={area}
          className="json__text"
          aria-label={`${baseName(path)} JSON`}
          aria-invalid={error !== null}
          spellCheck={false}
          wrap="off"
          value={draft}
          onChange={event => {
            setDraft(event.target.value)
            schedule(event.target.value)
          }}
          onBlur={() => { apply(draft) }}
          onScroll={event => { if (gutter.current) gutter.current.scrollTop = event.currentTarget.scrollTop }}
          onKeyDown={event => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              apply(draft)
            } else if (event.key === 'Tab' && !event.shiftKey) {
              event.preventDefault()
              const el = event.currentTarget
              const { selectionStart: from, selectionEnd: to } = el
              const next = `${draft.slice(0, from)}  ${draft.slice(to)}`
              setDraft(next)
              schedule(next)
              requestAnimationFrame(() => { el.setSelectionRange(from + 2, from + 2) })
            } else if (event.key === 'Escape' && error) {
              event.preventDefault()
              setDraft(synced.current.text)
              setError(null)
            }
          }}
        />
      </div>
      {error && <div className="json__error" role="status">{error} <span className="json__hint">Esc restores the last valid text.</span></div>}
    </section>
  )
}

const lineHeight = (el: HTMLElement): number => Number.parseFloat(getComputedStyle(el).lineHeight) || 16

/** Adds a line:column to JSON syntax errors that only give an offset. */
function describe(problem: string, text: string): string {
  const match = /position (\d+)/.exec(problem)
  if (!match || /line \d+/.test(problem)) return problem
  const before = text.slice(0, Number(match[1]))
  const line = before.split('\n').length
  const column = before.length - before.lastIndexOf('\n')
  return `${problem} (line ${line}, column ${column})`
}
