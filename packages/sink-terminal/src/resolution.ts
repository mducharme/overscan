import type { TerminalMode } from '@overscan/types'

export interface TerminalResolution {
  width: number
  height: number
}

export function terminalResolution(mode: TerminalMode): TerminalResolution {
  const cols = process.stdout.columns || 80
  const rawRows = process.stdout.rows || 24
  const reserveStatusLine = process.env['DEBUG_TERMINAL'] === '1' ? 1 : 0
  const rows = Math.max(2, rawRows - reserveStatusLine)

  switch (mode) {
    case 'sixel':
      // sixel: render at a fixed 2:1 pixel-per-cell ratio
      return { width: cols * 2, height: rows * 2 }

    case 'ansi':
      // each cell = 2 vertical pixels via ▀ half-block
      return { width: cols, height: rows * 2 }

    case 'ascii':
      // One char per cell; full grid cols × rows. (Vertical stretch vs scene is a UV/sampling concern.)
      return { width: cols, height: rows }
  }
}

/** Same rules as `terminalResolution`, but with explicit grid (e.g. export without a TTY). */
export function terminalResolutionFromGrid(
  mode: TerminalMode,
  cols: number,
  rows: number,
  options?: { reserveStatusLine?: number },
): TerminalResolution {
  const reserve = options?.reserveStatusLine ?? 0
  const effRows = Math.max(2, rows - reserve)
  switch (mode) {
    case 'sixel':
      return { width: cols * 2, height: effRows * 2 }
    case 'ansi':
      return { width: cols, height: effRows * 2 }
    case 'ascii':
      return { width: cols, height: effRows }
  }
}
