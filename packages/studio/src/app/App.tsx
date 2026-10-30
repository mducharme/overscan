import { useEffect, useRef, useState } from 'react'
import { baseName } from '../engine/paths'
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
  useEffect(() => bindPlayerKeys(store, () => { previewRef.current?.fullscreen() }), [store])
  useAudio()

  const title = document?.demo?.title ?? document?.scene?.title
  return (
    <div className="app">
      <header className="app__header">
        <div className="app__title">
          <span className="app__brand">Overscan</span>
          {document && <span className="app__file" title={document.filePath}>{baseName(document.filePath)}</span>}
          {title && <span className="app__doc-title">{title}</span>}
          {document && <span className="app__kind">{document.kind === 'demo' ? `${document.player.sections.length} sections` : 'scene'}</span>}
        </div>
        <Transport onScreenshot={() => previewRef.current?.screenshot()} onFullscreen={() => previewRef.current?.fullscreen()} />
      </header>
      <Notices />
      <main className="app__stage">
        {status === 'loading' && !document && <div className="app__placeholder">Loading…</div>}
        {status === 'idle' && <div className="app__placeholder">No file. Start the studio with <code>overscan dev &lt;file&gt;</code>.</div>}
        <Preview ref={previewRef} />
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
const clampHeight = (h: number): number => Math.round(Math.min(window.innerHeight * 0.75, Math.max(96, h)))

function readTimelineHeight(): number {
  try {
    const saved = Number(window.localStorage.getItem(HEIGHT_KEY))
    if (saved > 0) return clampHeight(saved)
  } catch { /* storage unavailable */ }
  return clampHeight(window.innerHeight * 0.32)
}

function saveTimelineHeight(h: number): void {
  try { window.localStorage.setItem(HEIGHT_KEY, String(h)) } catch { /* storage unavailable */ }
}
