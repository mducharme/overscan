import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { createPreviewRenderer, type PreviewRenderer } from '../engine/preview-renderer'
import { useStudio, useStudioStore } from './studio-context'

let documentCounter = 0

export interface PreviewHandle {
  screenshot(): void
  fullscreen(): void
}

/**
 * The preview canvas plus the playback loop: each animation frame advances the clock (when playing)
 * and redraws whenever the time changed. Re-creates the renderer when the mode, size or document changes.
 */
export const Preview = forwardRef<PreviewHandle>(function Preview(_props, ref) {
  const store = useStudioStore()
  const document = useStudio(s => s.document)
  const mode = useStudio(s => s.renderer)
  const scale = useStudio(s => s.renderScale)
  const playing = useStudio(s => s.playing)
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<PreviewRenderer | null>(null)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [display, setDisplay] = useState<{ width: number; height: number } | null>(null)
  const [fps, setFps] = useState(0)
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let timer = 0
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        setViewport({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) })
      }, 120)
    })
    observer.observe(container)
    return () => { observer.disconnect(); window.clearTimeout(timer) }
  }, [])

  // Everything that needs a new renderer, as one key. It also keys the <canvas>: a canvas keeps its first
  // context type (2D vs WebGL), so switching renderers needs a fresh element.
  const documentId = useMemo(() => (document ? `${document.filePath}@${document.mtimeMs}#${++documentCounter}` : ''), [document])
  const viewportKey = mode === 'ansi' || mode === 'ascii' ? `${viewport.width}x${viewport.height}` : viewport.width > 0 ? 'ready' : ''
  const rendererKey = `${documentId}|${mode}|${scale}|${viewportKey}`

  useEffect(() => {
    const canvas = canvasRef.current
    if (!document || !canvas || viewport.width === 0) return
    let cancelled = false
    let raf = 0
    let last = performance.now()
    let lastRendered = Number.NaN
    let frames = 0
    let fpsSince = last
    void createPreviewRenderer(canvas, document.player, { mode, scale, viewport })
      .then(renderer => {
        if (cancelled) { renderer.destroy(); return }
        rendererRef.current = renderer
        setDisplay(renderer.displaySize)
        const loop = (now: number): void => {
          const dt = Math.min(0.25, (now - last) / 1000)
          last = now
          const state = store.getState()
          state.advance(dt)
          const { time, renderError } = store.getState()
          if (time !== lastRendered && !renderError) {
            try {
              renderer.render(time, Number.isNaN(lastRendered) ? 0 : Math.max(0, time - lastRendered))
              lastRendered = time
              frames++
            } catch (error) {
              store.getState().reportRenderError(error instanceof Error ? error.message : String(error))
            }
          }
          if (now - fpsSince >= 500) {
            setFps(Math.round((frames * 1000) / (now - fpsSince)))
            frames = 0
            fpsSince = now
          }
          raf = requestAnimationFrame(loop)
        }
        raf = requestAnimationFrame(loop)
      })
      .catch((error: unknown) => {
        store.getState().reportRenderError(error instanceof Error ? error.message : String(error))
      })
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      rendererRef.current?.destroy()
      rendererRef.current = null
    }
    // rendererKey covers document, mode, scale and (for terminal modes) viewport; store is stable.
  }, [rendererKey])

  useImperativeHandle(ref, () => ({
    screenshot() {
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.toBlob(blob => {
        if (!blob) return
        const a = window.document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `overscan-${store.getState().time.toFixed(2)}s.png`
        a.click()
        URL.revokeObjectURL(a.href)
      })
    },
    fullscreen() {
      void containerRef.current?.requestFullscreen()
    },
  }), [store])

  return (
    <div className="preview" ref={containerRef}>
      {document && (
        <canvas
          key={rendererKey}
          ref={canvasRef}
          className={`preview__canvas preview__canvas--${mode}`}
          style={display ? { width: display.width, height: display.height } : { aspectRatio: `${document.player.resolution.width} / ${document.player.resolution.height}` }}
        />
      )}
      {document && <div className="preview__stats">{playing ? `${fps} fps` : 'paused'} · {mode.toUpperCase()}</div>}
    </div>
  )
})
