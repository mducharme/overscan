import { useEffect } from 'react'
import { baseName } from '../engine/paths'
import { dirtyFiles } from '../state/store'
import { Button } from '../ui/kit'
import { useStudio, useStudioStore } from './studio-context'

/** Undo/redo, the unsaved-changes indicator with Save and Revert; also warns before leaving with unsaved edits. */
export function SaveControls() {
  const store = useStudioStore()
  const dirty = useStudio(s => dirtyFiles(s.document).map(f => f.path).join('\n'))
  const saving = useStudio(s => s.saving)
  const undoLabel = useStudio(s => s.past.at(-1)?.label ?? null)
  const redoLabel = useStudio(s => s.future.at(-1)?.label ?? null)
  const count = dirty ? dirty.split('\n').length : 0

  useEffect(() => {
    if (!count) return
    const warn = (event: BeforeUnloadEvent): void => { event.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => { window.removeEventListener('beforeunload', warn) }
  }, [count])

  const history = (
    <span className="history">
      <Button variant="ghost" icon disabled={!undoLabel} title={undoLabel ? `Undo ${undoLabel} (⌘Z)` : 'Nothing to undo'} aria-label="Undo" onClick={() => { store.getState().undo() }}>↶</Button>
      <Button variant="ghost" icon disabled={!redoLabel} title={redoLabel ? `Redo ${redoLabel} (⇧⌘Z)` : 'Nothing to redo'} aria-label="Redo" onClick={() => { store.getState().redo() }}>↷</Button>
    </span>
  )
  if (!count) return <span className="save save--clean">{history}Saved</span>
  return (
    <span className="save">
      {history}
      <span className="save__dot" title={dirty.split('\n').map(baseName).join('\n')}>● {count === 1 ? baseName(dirty) : `${count} files`} unsaved</span>
      <Button variant="primary" disabled={saving} title="Save (⌘S)" onClick={() => { void store.getState().save() }}>{saving ? 'Saving…' : 'Save'}</Button>
      <Button
        variant="ghost"
        disabled={saving}
        title="Discard unsaved changes and reload from disk"
        onClick={() => { if (window.confirm('Discard unsaved changes?')) void store.getState().revert() }}
      >
        Revert
      </Button>
    </span>
  )
}
