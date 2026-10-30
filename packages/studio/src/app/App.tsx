import { useEffect, useRef } from 'react'
import { baseName } from '../engine/paths'
import { Notices } from './Notices'
import { Preview, type PreviewHandle } from './Preview'
import { ScrubBar } from './ScrubBar'
import { useStudio, useStudioStore } from './studio-context'
import { Transport } from './Transport'
import { bindPlayerKeys } from './keyboard'

export function App() {
  const store = useStudioStore()
  const status = useStudio(s => s.status)
  const document = useStudio(s => s.document)
  const previewRef = useRef<PreviewHandle>(null)

  useEffect(() => bindPlayerKeys(store, () => { previewRef.current?.fullscreen() }), [store])

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
      <footer className="app__footer">
        <ScrubBar />
      </footer>
    </div>
  )
}
