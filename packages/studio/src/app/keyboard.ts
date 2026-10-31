import type { StudioStore } from '../state/store'

/**
 * Player shortcuts, matching `overscan run`: Space play/pause, ←/→ previous/next section in a demo
 * (±5 s in a scene), ↑/↓ double/halve the rate, Home rewind, L loop, M mute, F fullscreen, G side panel, J JSON,
 * Esc deselect, Delete/Backspace remove the selected node, ⌘/Ctrl+S save, ⌘/Ctrl+Z undo, ⇧⌘Z or Ctrl+Y redo.
 * Ignored while typing in a field (text fields keep their own undo). Returns a function that removes the listener.
 */
export function bindPlayerKeys(store: StudioStore, actions: { fullscreen: () => void; toggleGraph: () => void; toggleJson: () => void }): () => void {
  const onKey = (event: KeyboardEvent): void => {
    const target = event.target
    const s = store.getState()
    // ⌘S / Ctrl+S saves, even from inside a field (after it commits on blur).
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      if (target instanceof HTMLElement) target.blur()
      void s.save()
      return
    }
    const inField = target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]') !== null
    const key = event.key.toLowerCase()
    if ((event.metaKey || event.ctrlKey) && (key === 'z' || key === 'y')) {
      // Text fields undo their own typing; elsewhere (sliders, pickers, the graph) undo document edits.
      const textField = target instanceof Element && target.closest('textarea, input:not([type=range]):not([type=color]):not([type=checkbox])') !== null
      if (textField) return
      event.preventDefault()
      if (key === 'y' || event.shiftKey) s.redo()
      else s.undo()
      return
    }
    if (inField) return
    if (event.metaKey || event.ctrlKey || event.altKey) return
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
      case 'f': case 'F': actions.fullscreen(); break
      case 'g': case 'G': actions.toggleGraph(); break
      case 'j': case 'J': actions.toggleJson(); break
      case 'Escape': if (!s.selectedNodeId) return; s.selectNode(null); break
      case 'Delete': case 'Backspace': {
        const section = player.sectionAt(s.time) ?? player.sections.at(-1)
        if (!s.selectedNodeId || !section) return
        s.removeNode(section.scenePath, s.selectedNodeId)
        break
      }
      default: return
    }
    event.preventDefault()
  }
  window.addEventListener('keydown', onKey)
  return () => { window.removeEventListener('keydown', onKey) }
}
