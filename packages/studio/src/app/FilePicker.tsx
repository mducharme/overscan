import { useEffect, useMemo, useRef, useState } from 'react'
import { baseName } from '../engine/paths'
import { dirtyFiles } from '../state/store'
import { useBridge, useStudio, useStudioStore } from './studio-context'

interface Listing {
  root: string
  files: string[]
}

/**
 * The open file's name; click it to open another scene or demo of the project. Type to filter, ↑/↓ and
 * Enter to pick. Unsaved edits are confirmed first, and the URL remembers the file for reloads.
 */
export function FilePicker() {
  const store = useStudioStore()
  const bridge = useBridge()
  const filePath = useStudio(s => s.document?.filePath ?? null)
  const [open, setOpen] = useState(false)
  const [listing, setListing] = useState<Listing | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
    if (!bridge.list) {
      setError('Listing files needs the dev server (overscan dev).')
      return
    }
    bridge.list().then(l => { setListing(l); setError(null) }, (e: unknown) => { setError(e instanceof Error ? e.message : String(e)) })
    const close = (event: PointerEvent): void => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    window.addEventListener('pointerdown', close)
    return () => { window.removeEventListener('pointerdown', close) }
  }, [open, bridge])

  const matches = useMemo(() => {
    if (!listing) return []
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    return listing.files
      .map(path => ({ path, label: relative(listing.root, path) }))
      .filter(f => words.every(w => f.label.toLowerCase().includes(w)))
  }, [listing, query])

  const pick = (path: string): void => {
    setOpen(false)
    if (path === filePath) return
    if (dirtyFiles(store.getState().document).length && !window.confirm('Open another file and discard unsaved changes?')) return
    const url = new URL(window.location.href)
    url.searchParams.set('file', path)
    window.history.replaceState(null, '', url)
    void store.getState().openDocument(path)
  }

  return (
    <div ref={root} className="files">
      <button type="button" className="files__current" aria-haspopup="listbox" aria-expanded={open} title={filePath ? `${filePath}\nOpen another file` : 'Open a file'} onClick={() => { setOpen(v => !v) }}>
        {filePath ? baseName(filePath) : 'Open…'} <span aria-hidden>▾</span>
      </button>
      {open && (
        <div className="files__popover">
          <input
            className="ui-input"
            autoFocus
            aria-label="Filter files"
            placeholder="Filter scenes and demos…"
            value={query}
            onChange={e => { setQuery(e.target.value); setActive(0) }}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(matches.length - 1, i + 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)) }
              else if (e.key === 'Enter' && matches[active]) pick(matches[active].path)
              else if (e.key === 'Escape') setOpen(false)
            }}
          />
          {error && <div className="files__note files__note--error">{error}</div>}
          {!error && !listing && <div className="files__note">Listing…</div>}
          {listing && matches.length === 0 && <div className="files__note">No matching files.</div>}
          <ul className="files__list" role="listbox" aria-label="Files">
            {matches.map((f, i) => (
              <li
                key={f.path}
                role="option"
                aria-selected={i === active}
                className={`files__item${f.path === filePath ? ' files__item--open' : ''}`}
                ref={i === active ? el => { el?.scrollIntoView({ block: 'nearest' }) } : undefined}
                onPointerEnter={() => { setActive(i) }}
                onClick={() => { pick(f.path) }}
              >
                <span className="files__name">{baseName(f.path)}</span>
                <span className="files__dir">{f.label.slice(0, -baseName(f.path).length).replace(/[/\\]$/, '')}</span>
                {f.path.endsWith('.demo.json') && <span className="files__kind">demo</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

const relative = (root: string, path: string): string => {
  const prefix = root.endsWith('/') || root.endsWith('\\') ? root : `${root}/`
  return path.startsWith(prefix) || path.startsWith(`${root}\\`) ? path.slice(prefix.length) : path
}
