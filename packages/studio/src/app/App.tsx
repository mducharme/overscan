import { useEffect, useRef, useState } from 'react'
import { Button, ToggleGroup } from '../ui/kit'
import { DemoPanel } from './DemoPanel'
import { ExportDialog } from './ExportDialog'
import { FilePicker } from './FilePicker'
import { GraphPanel } from './GraphPanel'
import { Inspector } from './Inspector'
import { JsonPanel } from './JsonPanel'
import { SaveControls } from './SaveControls'
import { Notices } from './Notices'
import { Preview, type PreviewHandle } from './Preview'
import { useStudio, useStudioStore } from './studio-context'
import { Timeline } from './Timeline'
import { Transport } from './Transport'
import { useAudio } from './useAudio'
import { bindPlayerKeys } from './keyboard'

export function App() {
  const store = useStudioStore()
  const status = useStudio(s => s.status)
  const document = useStudio(s => s.document)
  const previewRef = useRef<PreviewHandle>(null)

  const [timelineHeight, setTimelineHeight] = useState(readTimelineHeight)
  const [showSide, setShowSide] = useState(() => readStored(GRAPH_KEY) !== 'hidden')
  const [sideTab, setSideTab] = useState<SideTab>(() => {
    const stored = readStored(TAB_KEY)
    return stored === 'json' || stored === 'demo' ? stored : 'graph'
  })
  const [exporting, setExporting] = useState(false)
  const isDemo = document?.kind === 'demo'
  // The demo tab only exists for demos; a scene falls back to the graph.
  const tab: SideTab = sideTab === 'demo' && !isDemo ? 'graph' : sideTab
  const toggleSide = (): void => { setShowSide(v => { writeStored(GRAPH_KEY, v ? 'hidden' : 'shown'); return !v }) }
  const showTab = (tab: SideTab): void => {
    setSideTab(tab)
    writeStored(TAB_KEY, tab)
    setShowSide(true)
    writeStored(GRAPH_KEY, 'shown')
  }
  useEffect(() => bindPlayerKeys(store, {
    fullscreen: () => { previewRef.current?.fullscreen() },
    toggleGraph: toggleSide,
    toggleJson: () => { setSideTab(tab => { const next = tab === 'json' ? 'graph' : 'json'; writeStored(TAB_KEY, next); return next }); setShowSide(true) },
  }), [store])
  useAudio()

  const title = document?.demo?.title ?? document?.scene?.title
  return (
    <div className="app">
      <header className="app__header">
        <div className="app__title">
          <span className="app__brand">Overscan</span>
          <FilePicker />
          {title && <span className="app__doc-title">{title}</span>}
          {document && <span className="app__kind">{document.kind === 'demo' ? `${document.player.sections.length} sections` : 'scene'}</span>}
          {document && <SaveControls />}
        </div>
        <Transport onScreenshot={() => previewRef.current?.screenshot()} onFullscreen={() => previewRef.current?.fullscreen()} />
        {document && <Button variant="ghost" title="Render a GIF, MP4 or PNG frames" onClick={() => { setExporting(true) }}>Export…</Button>}
        {exporting && <ExportDialog onClose={() => { setExporting(false) }} />}
        {document && (
          <ToggleGroup
            label="Side panel"
            value={showSide ? tab : 'none'}
            options={[
              { value: 'graph', label: 'Graph', title: 'Node graph and inspector (G shows or hides the panel)' },
              ...(isDemo ? [{ value: 'demo' as const, label: 'Demo', title: 'Sections, transitions, soundtrack and demo-wide modifiers' }] : []),
              { value: 'json', label: 'JSON', title: 'View and edit the JSON (J)' },
            ]}
            onChange={next => { if (showSide && next === tab) toggleSide(); else if (next !== 'none') showTab(next) }}
          />
        )}
      </header>
      <Notices />
      <main className="app__stage">
        {status === 'loading' && !document && <div className="app__placeholder">Loading…</div>}
        {status === 'idle' && <div className="app__placeholder">No file. Start the studio with <code>overscan dev &lt;file&gt;</code>.</div>}
        <Preview ref={previewRef} />
        {document && showSide && (
          <aside className="app__side">
            {tab === 'graph' ? <><GraphPanel /><Inspector /></> : tab === 'demo' ? <DemoPanel /> : <JsonPanel />}
          </aside>
        )}
      </main>
      {document && (
        <footer className="app__footer" style={{ height: timelineHeight }}>
          <div
            className="app__resize"
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize timeline"
            onPointerDown={event => {
              event.currentTarget.setPointerCapture(event.pointerId)
              const startY = event.clientY
              const startH = timelineHeight
              const target = event.currentTarget
              const move = (e: PointerEvent): void => { setTimelineHeight(clampHeight(startH + startY - e.clientY)) }
              const up = (e: PointerEvent): void => {
                target.removeEventListener('pointermove', move)
                target.removeEventListener('pointerup', up)
                saveTimelineHeight(clampHeight(startH + startY - e.clientY))
              }
              target.addEventListener('pointermove', move)
              target.addEventListener('pointerup', up)
            }}
          />
          <Timeline />
        </footer>
      )}
    </div>
  )
}

const HEIGHT_KEY = 'overscan.studio.timelineHeight'
const GRAPH_KEY = 'overscan.studio.graph'
const TAB_KEY = 'overscan.studio.sideTab'
type SideTab = 'graph' | 'demo' | 'json'
const clampHeight = (h: number): number => Math.round(Math.min(window.innerHeight * 0.75, Math.max(96, h)))

// Layout preferences live in localStorage, which can be unavailable (private windows, blocked storage).
function readStored(key: string): string | null {
  try { return window.localStorage.getItem(key) } catch { return null }
}

function writeStored(key: string, value: string): void {
  try { window.localStorage.setItem(key, value) } catch { /* storage unavailable */ }
}

function readTimelineHeight(): number {
  const saved = Number(readStored(HEIGHT_KEY))
  return clampHeight(saved > 0 ? saved : window.innerHeight * 0.32)
}

function saveTimelineHeight(h: number): void {
  writeStored(HEIGHT_KEY, String(h))
}
