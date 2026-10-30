import type { TerminalSink } from './sink.js'

/** One-line summary for stderr after a run (mode, buffer size, TTY, common env). */
export function describeTerminalSession(sink: TerminalSink): string {
  const r = sink.resolution
  // columns/rows are only defined when stdout is a terminal, despite Node's typings.
  const ttyCols = process.stdout.isTTY ? process.stdout.columns : undefined
  const ttyRows = process.stdout.isTTY ? process.stdout.rows : undefined
  const parts = [
    `mode=${sink.currentMode}`,
    `buffer=${r.width}x${r.height}`,
    `tty=${ttyCols ?? '?'}x${ttyRows ?? '?'}`,
    `stdoutTTY=${process.stdout.isTTY ? '1' : '0'}`,
  ]
  const term = process.env['TERM']
  if (term) parts.push(`TERM=${term}`)
  const ct = process.env['COLORTERM']
  if (ct) parts.push(`COLORTERM=${ct}`)
  if (process.env['WEZTERM_EXECUTABLE']) parts.push('WEZTERM=1')
  if (process.env['DEMO_SIXEL'] === '1') parts.push('DEMO_SIXEL=1')
  return parts.join(' ')
}
