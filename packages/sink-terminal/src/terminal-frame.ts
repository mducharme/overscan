import type { FrameBuffer, TerminalMode } from '@overscan/types'
import { renderAscii } from './renderers/ascii.js'
import { renderAnsi } from './renderers/ansi.js'
import { renderSixel } from './renderers/sixel.js'

/** Escape sequence body only (no cursor motion) — same bytes the terminal interprets after home. */
export function buildTerminalFrameBody(mode: TerminalMode, frame: FrameBuffer): string {
  switch (mode) {
    case 'sixel':
      return renderSixel(frame)
    case 'ansi':
      return renderAnsi(frame)
    case 'ascii':
      return renderAscii(frame)
  }
}

/** Leader written before the body in TerminalSink (cursor home + optional SGR reset for sixel). */
export function terminalFrameLeader(mode: TerminalMode): string {
  return mode === 'sixel' ? '\x1b[H\x1b[0m' : '\x1b[H'
}
