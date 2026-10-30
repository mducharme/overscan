import { Alert, Button, Card, InputNumber, Space, Tag, Typography } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PreviewRenderer } from '../store/studio'
import { fitTerminalStyle, terminalGridForViewport, type PreviewState } from '../lib/preview'

export function PreviewPanel({
  renderer,
  previewState,
  resolution,
  playbackRate,
  profileOverlay,
  glCanvasRef,
  canvas2dRef,
  onResolutionChange,
  onSeek,
  onViewportChange,
}: {
  renderer: PreviewRenderer
  previewState: PreviewState
  resolution: { width: number; height: number } | null
  playbackRate: number
  profileOverlay: boolean
  glCanvasRef: React.RefObject<HTMLCanvasElement>
  canvas2dRef: React.RefObject<HTMLCanvasElement>
  onResolutionChange(resolution: { width: number; height: number }): void
  onSeek(time: number): void
  onViewportChange(width: number, height: number): void
}): JSX.Element {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState({ width: 640, height: 360 })

  useEffect(() => {
    const element = viewportRef.current
    if (!element) return
    const observer = new ResizeObserver(entries => {
      const entry = entries[0]
      if (!entry) return
      const next = {
        width: Math.floor(entry.contentRect.width),
        height: Math.floor(entry.contentRect.height),
      }
      setViewport(next)
      onViewportChange(next.width, next.height)
    })
    observer.observe(element)
    return () => { observer.disconnect(); }
  }, [onViewportChange])

  const terminalStyle = useMemo(() => {
    const grid = terminalGridForViewport(viewport)
    return fitTerminalStyle(viewport, grid)
  }, [previewState.asciiHtml, previewState.ansiHtml, viewport])

  function renderRendererView(activeRenderer: PreviewRenderer): JSX.Element {
    if (activeRenderer === 'ascii') {
      return <pre className="terminalPreview terminalPreviewFit" style={terminalStyle} dangerouslySetInnerHTML={{ __html: previewState.asciiHtml }} />
    }
    if (activeRenderer === 'ansi') {
      return <pre className="terminalPreview terminalPreviewFit" style={terminalStyle} dangerouslySetInnerHTML={{ __html: previewState.ansiHtml }} />
    }
    return (
      <div className="previewCanvasStack">
        <canvas
          ref={canvas2dRef}
          className={`previewCanvas ${activeRenderer === '2d' ? 'previewCanvasVisible' : 'previewCanvasHidden'}`}
        />
        <canvas
          ref={glCanvasRef}
          className={`previewCanvas ${activeRenderer === 'gl' ? 'previewCanvasVisible' : 'previewCanvasHidden'}`}
        />
      </div>
    )
  }

  function screenshot(): void {
    const canvas = renderer === '2d' ? canvas2dRef.current : renderer === 'gl' ? glCanvasRef.current : null
    if (!canvas) return
    const url = canvas.toDataURL('image/png')
    const link = document.createElement('a')
    link.href = url
    link.download = 'overscan-preview.png'
    link.click()
  }

  function toggleFullscreen(): void {
    const root = document.documentElement
    if (document.fullscreenElement) {
      void document.exitFullscreen()
      return
    }
    void root.requestFullscreen()
  }

  return (
    <Card
      className="studioPanel previewPanelCard"
      title="Preview"
      extra={(
        <Space size="small">
          {resolution ? <Typography.Text type="secondary">{resolution.width} x {resolution.height}</Typography.Text> : null}
          {profileOverlay && <Tag color="orange">Profile</Tag>}
        </Space>
      )}
    >
      <div className="previewLayoutSingle">
        <div className="previewPane" ref={viewportRef}>
          {renderRendererView(renderer)}
        </div>
      </div>
      <div className="previewControls">
        <Space wrap>
          <Typography.Text type="secondary">Resolution</Typography.Text>
          <Space.Compact size="small">
            <InputNumber
              size="small"
              value={resolution?.width}
              min={16}
              onChange={value => resolution && value && onResolutionChange({ width: value, height: resolution.height })}
            />
            <Button size="small" disabled>w</Button>
          </Space.Compact>
          <Space.Compact size="small">
            <InputNumber
              size="small"
              value={resolution?.height}
              min={16}
              onChange={value => resolution && value && onResolutionChange({ width: resolution.width, height: value })}
            />
            <Button size="small" disabled>h</Button>
          </Space.Compact>
        </Space>
        <Space wrap>
          <Tag>Rate {playbackRate}x</Tag>
          <Tag>Pixel ratio 1x</Tag>
          <Button size="small" onClick={() => { onSeek(0); }}>Start</Button>
          <Button size="small" onClick={toggleFullscreen}>Fullscreen</Button>
          <Button size="small" disabled={renderer !== '2d' && renderer !== 'gl'} onClick={screenshot}>Screenshot</Button>
        </Space>
      </div>
      {previewState.lastError && (
        <Alert className="previewAlert" type="error" showIcon message={previewState.lastError} />
      )}
    </Card>
  )
}
