import { useEffect } from 'react'
import { AudioPlayback, timelineAudio } from '../engine/audio'
import { useBridge, useStudio, useStudioStore } from './studio-context'

/** Plays the document's audio in step with the studio clock. */
export function useAudio(): void {
  const store = useStudioStore()
  const bridge = useBridge()
  // Keyed by the player: config edits replace the document object but must not restart the audio.
  const player = useStudio(s => s.document?.player)
  useEffect(() => {
    const { document } = store.getState()
    if (!player || !document) return
    const clips = timelineAudio(document)
    if (clips.length === 0) return
    const playback = new AudioPlayback(clips, path => bridge.mediaUrl(path))
    const sync = (): void => {
      const { time, playing, rate, muted } = store.getState()
      playback.sync(time, playing, rate, muted)
    }
    sync()
    const unsubscribe = store.subscribe(sync)
    return () => { unsubscribe(); playback.destroy() }
  }, [store, bridge, player])
}
