import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ExportJob, ExportKind, ExportRequest } from '../engine/bridge'
import { baseName, resolvePath } from '../engine/paths'
import { dirtyFiles } from '../state/store'
import { Button, NumberField, Select, ToggleGroup } from '../ui/kit'
import { TextInput } from './Inspector'
import { useBridge, useStudio, useStudioStore } from './studio-context'

type Look = 'full' | 'ansi' | 'ascii'
const POLL_MS = 300
const EXTENSIONS: Record<ExportKind, string> = { gif: '.gif', mp4: '.mp4', png: '-frames' }

/**
 * Renders the open file with the CLI's exporter on the dev server: GIF, MP4 (with the soundtrack) or a
 * PNG sequence, at full resolution or rasterised like the terminal player. Exports read the files on
 * disk, so unsaved edits are saved first.
 */
export function ExportDialog({ onClose }: { onClose: () => void }) {
  const store = useStudioStore()
  const bridge = useBridge()
  const filePath = useStudio(s => s.document?.filePath ?? '')
  const totalFrames = useStudio(s => (s.document ? Math.ceil(s.document.player.duration * s.document.player.fps) : 0))
  const unsaved = useStudio(s => dirtyFiles(s.document).length)
  const renderer = useStudio(s => s.renderer)
  const [kind, setKind] = useState<ExportKind>('gif')
  const [look, setLook] = useState<Look>(renderer === 'ansi' || renderer === 'ascii' ? renderer : 'full')
  const [cols, setCols] = useState(160)
  const [rows, setRows] = useState(50)
  const [output, setOutput] = useState('')
  const [job, setJob] = useState<ExportJob | null>(null)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const stem = baseName(filePath).replace(/\.(scene|demo)\.json$/, '')
  const target = resolvePath(filePath, output || `./${stem}${EXTENSIONS[kind]}`)
  const running = job?.state === 'running'

  // Pick up an export that is already running (e.g. after closing and reopening the dialog).
  useEffect(() => {
    bridge.exportStatus?.().then(j => { if (j?.state === 'running') setJob(j) }, () => {})
  }, [bridge])
  useEffect(() => {
    if (!running || !bridge.exportStatus) return
    const poll = (): void => {
      bridge.exportStatus!().then(j => {
        setJob(j)
        if (j?.state === 'running') timer.current = window.setTimeout(poll, POLL_MS)
      }, (e: unknown) => { setError(e instanceof Error ? e.message : String(e)) })
    }
    timer.current = window.setTimeout(poll, POLL_MS)
    return () => { window.clearTimeout(timer.current) }
  }, [running, bridge])
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape' && !running) onClose() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [running, onClose])

  if (!bridge.startExport) {
    return <Modal onClose={onClose}><p>Exporting needs the dev server (<code>overscan dev</code>).</p></Modal>
  }

  const start = async (): Promise<void> => {
    setError(null)
    if (unsaved) {
      await store.getState().save()
      if (dirtyFiles(store.getState().document).length) {
        setError('Save failed, so the export would not include your edits. See the notice above.')
        return
      }
    }
    const request: ExportRequest = {
      filePath,
      kind,
      output: target,
      ...(look !== 'full' ? { terminal: { mode: look, cols, rows, cellWidth: 8, cellHeight: 16 } } : {}),
    }
    try {
      setJob(await bridge.startExport!(request))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const progress = job && totalFrames ? Math.min(1, job.frames / totalFrames) : 0
  return (
    <Modal onClose={running ? undefined : onClose}>
      <h2 className="export__title">Export {baseName(filePath)}</h2>
      <div className="export__form">
        <label><span>Format</span>
          <ToggleGroup
            label="Format"
            value={kind}
            options={[{ value: 'gif', label: 'GIF' }, { value: 'mp4', label: 'MP4', title: 'H.264, with the soundtrack' }, { value: 'png', label: 'PNG frames' }]}
            onChange={setKind}
          />
        </label>
        <label><span>Look</span>
          <Select
            label="Look"
            value={look}
            options={[
              { value: 'full', label: 'Full resolution' },
              { value: 'ansi', label: 'Terminal: ANSI blocks' },
              { value: 'ascii', label: 'Terminal: ASCII' },
            ]}
            onChange={setLook}
          />
        </label>
        {look !== 'full' && (
          <label><span>Grid</span>
            <span className="export__grid">
              <NumberField aria-label="Columns" value={cols} min={20} max={400} step={1} onCommit={v => { setCols(Math.round(v)) }} /> ×
              <NumberField aria-label="Rows" value={rows} min={8} max={200} step={1} onCommit={v => { setRows(Math.round(v)) }} /> cells
            </span>
          </label>
        )}
        <label><span>Save to</span>
          <TextInput label="Output path" value={output} placeholder={`./${stem}${EXTENSIONS[kind]}`} onCommit={setOutput} />
        </label>
        <div className="export__target" title={target}>{target}</div>
      </div>
      {unsaved > 0 && !job && <p className="export__note">Exports read the files on disk: your unsaved changes are saved first.</p>}
      {job && (
        <div className="export__status" role="status">
          {job.state === 'running' && (
            <>
              <progress max={1} value={progress} />
              <span>Frame {job.frames} of {totalFrames}</span>
            </>
          )}
          {job.state === 'done' && <span className="export__done">Done: <code>{job.output}</code></span>}
          {job.state === 'cancelled' && <span>Cancelled.</span>}
          {job.state === 'error' && <span className="export__error">{job.error}</span>}
        </div>
      )}
      {job?.state === 'done' && kind === 'gif' && <img className="export__preview" src={`${bridge.mediaUrl(job.output)}&v=${job.id}`} alt="Exported GIF" />}
      {job?.state === 'done' && kind === 'mp4' && <video className="export__preview" src={`${bridge.mediaUrl(job.output)}&v=${job.id}`} controls />}
      {error && <p className="export__error">{error}</p>}
      <div className="export__actions">
        {running
          ? <Button onClick={() => { void bridge.cancelExport?.() }}>Cancel export</Button>
          : <Button variant="primary" onClick={() => { void start() }}>{unsaved ? 'Save and export' : job ? 'Export again' : 'Export'}</Button>}
        <Button variant="ghost" disabled={running} onClick={onClose}>Close</Button>
      </div>
    </Modal>
  )
}

function Modal({ onClose, children }: { onClose?: (() => void) | undefined; children: ReactNode }) {
  return (
    <div className="modal" role="presentation" onPointerDown={event => { if (event.target === event.currentTarget) onClose?.() }}>
      <div className="modal__box" role="dialog" aria-modal aria-label="Export">{children}</div>
    </div>
  )
}
