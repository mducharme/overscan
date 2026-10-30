import { formatTime } from '../engine/format'
import type { Renderer, RenderScale } from '../state/store'
import { Button, Select, ToggleGroup } from '../ui/kit'
import { useStudio, useStudioStore } from './studio-context'

// Terminal previews first: they show what `overscan run` will look like.
const RENDERERS = [
  { value: 'ansi', label: 'ANSI', title: 'Terminal half-block preview (as `overscan run` shows it)' },
  { value: 'ascii', label: 'ASCII', title: 'Terminal character preview' },
  { value: '2d', label: '2D', title: 'CPU rendering on a 2D canvas' },
  { value: 'gl', label: 'GL', title: 'WebGL: GPU paths where effects have them' },
] as const satisfies readonly { value: Renderer; label: string; title: string }[]

const RATES = [0.25, 0.5, 1, 2, 4]
const SCALES: readonly { value: `${RenderScale}`; label: string }[] = [
  { value: '1', label: 'Full res' },
  { value: '0.5', label: 'Half res' },
  { value: '0.25', label: 'Quarter res' },
]

export function Transport({ onScreenshot, onFullscreen }: { onScreenshot: () => void; onFullscreen: () => void }) {
  const playing = useStudio(s => s.playing)
  const time = useStudio(s => s.time)
  const duration = useStudio(s => s.document?.player.duration ?? 0)
  const rate = useStudio(s => s.rate)
  const loop = useStudio(s => s.loop)
  const muted = useStudio(s => s.muted)
  const renderer = useStudio(s => s.renderer)
  const renderScale = useStudio(s => s.renderScale)
  const ready = useStudio(s => s.status === 'ready')
  // Actions never change, so read them once instead of subscribing to the whole state.
  const { togglePlay, seek, setRate, setLoop, setMuted, setRenderer, setRenderScale } = useStudioStore().getState()

  return (
    <div className="transport">
      <div className="transport__group">
        <Button variant="ghost" title="Back to start (Home)" disabled={!ready} onClick={() => { seek(0) }}>⏮</Button>
        <Button variant="primary" className="transport__play" title="Play / pause (Space)" disabled={!ready} onClick={togglePlay}>
          {playing ? 'Pause' : 'Play'}
        </Button>
        <span className="transport__time" aria-label="Time">
          <strong>{formatTime(time)}</strong> / {formatTime(duration)}
        </span>
      </div>
      <div className="transport__group">
        <Select
          label="Playback rate"
          value={String(rate)}
          options={(RATES.includes(rate) ? RATES : [...RATES, rate].sort((a, b) => a - b)).map(r => ({ value: String(r), label: `${r}×` }))}
          onChange={value => { setRate(Number(value)) }}
        />
        <ToggleGroup
          label="Loop"
          value={loop ? 'loop' : 'once'}
          options={[{ value: 'once', label: 'Once' }, { value: 'loop', label: 'Loop' }]}
          onChange={value => { setLoop(value === 'loop') }}
        />
        <Button variant="ghost" title="Mute audio (M)" aria-pressed={muted} onClick={() => { setMuted(!muted) }}>{muted ? 'Unmute' : 'Mute'}</Button>
      </div>
      <div className="transport__group transport__group--end">
        <ToggleGroup label="Renderer" value={renderer} options={RENDERERS} onChange={setRenderer} />
        <Select
          label="Render resolution"
          value={String(renderScale) as `${RenderScale}`}
          options={SCALES}
          onChange={value => { setRenderScale(Number(value) as RenderScale) }}
        />
        <Button variant="ghost" title="Save a PNG of the current frame" disabled={!ready} onClick={onScreenshot}>Screenshot</Button>
        <Button variant="ghost" title="Fullscreen preview (F)" disabled={!ready} onClick={onFullscreen}>Fullscreen</Button>
      </div>
    </div>
  )
}
