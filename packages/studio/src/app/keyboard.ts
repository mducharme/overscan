import type { StudioStore } from '../state/store'

/**
 * Player shortcuts, matching `overscan run`: Space play/pause, ←/→ previous/next section in a demo
 * (±5 s in a scene), ↑/↓ double/halve the rate, Home rewind, L loop, M mute, F fullscreen.
 * Ignored while typing in a field. Returns a function that removes the listener.
 */
export function bindPlayerKeys(store: StudioStore, onFullscreen: () => void): () => void {
  const onKey = (event: KeyboardEvent): void => {
    const target = event.target
    if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]')) return
    if (event.metaKey || event.ctrlKey || event.altKey) return
    const s = store.getState()
    const player = s.document?.player
    if (!player) return
    const step = (direction: -1 | 1): void => {
      if (player.sections.length <= 1) {
        s.seek(s.time + direction * 5)
        return
      }
      const index = player.sections.findIndex(section => section === player.sectionAt(s.time))
      const next = player.sections[Math.min(player.sections.length - 1, Math.max(0, index + direction))]
      if (next) s.seek(next.start)
    }
    switch (event.key) {
      case ' ': s.togglePlay(); break
      case 'ArrowLeft': step(-1); break
      case 'ArrowRight': step(1); break
      case 'ArrowUp': s.setRate(s.rate * 2); break
      case 'ArrowDown': s.setRate(s.rate / 2); break
      case 'Home': s.seek(0); break
      case 'l': case 'L': s.setLoop(!s.loop); break
      case 'm': case 'M': s.setMuted(!s.muted); break
      case 'f': case 'F': onFullscreen(); break
      default: return
    }
    event.preventDefault()
  }
  window.addEventListener('keydown', onKey)
  return () => { window.removeEventListener('keydown', onKey) }
}
