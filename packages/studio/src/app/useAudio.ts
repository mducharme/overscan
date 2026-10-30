import { useEffect } from 'react'
import { AudioPlayback, timelineAudio } from '../engine/audio'
import { useBridge, useStudio, useStudioStore } from './studio-context'

/** Plays the document's audio in step with the studio clock. */
export function useAudio(): void {
  const store = useStudioStore()
  const bridge = useBridge()
  const document = useStudio(s => s.document)
  useEffect(() => {
    if (!document) return
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
  }, [store, bridge, document])
}
