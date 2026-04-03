import type { TerminalMode } from '@overscan/types'

export function detectMode(): TerminalMode {
  const term      = process.env['TERM'] ?? ''
  const termProg  = process.env['TERM_PROGRAM'] ?? ''
  const colorterm = process.env['COLORTERM'] ?? ''

  // WezTerm: prefer ANSI block by default (truecolor half-blocks). Some Node + sixel
  // combinations show a blank screen; set DEMO_SIXEL=1 to force sixel.
  if (process.env['WEZTERM_EXECUTABLE'] !== undefined) {
    return process.env['DEMO_SIXEL'] === '1' ? 'sixel' : 'ansi'
  }

  // sixel-capable terminals
  if (
    termProg === 'iTerm.app' ||
    term.includes('mlterm') ||
    (term.includes('xterm') && process.env['TERM_PROGRAM_VERSION'] !== undefined)
  ) {
    return 'sixel'
  }

  // 24-bit colour → ANSI block
  if (colorterm === 'truecolor' || colorterm === '24bit') {
    return 'ansi'
  }

  return 'ascii'
}
