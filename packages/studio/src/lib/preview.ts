export interface PreviewState {
  asciiHtml: string
  ansiHtml: string
  fps: number
  lastError: string | null
}

export interface FramePreviewBuffer {
  width: number
  height: number
  data: Uint8ClampedArray
}

export function formatTime(seconds: number): string {
  const wholeMinutes = Math.floor(seconds / 60)
  const wholeSeconds = Math.floor(seconds % 60)
  const tenths = Math.floor((seconds % 1) * 10)
  return `${String(wholeMinutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}.${tenths}`
}

export function parseTimecode(raw: string): number | null {
  const value = raw.trim()
  if (!value) return null
  if (/^\d+(\.\d+)?$/.test(value)) return Number(value)
  const match = /^(\d+):(\d{1,2})(?:\.(\d+))?$/.exec(value)
  if (!match) return null
  const minutes = Number(match[1] ?? 0)
  const seconds = Number(match[2] ?? 0)
  const fraction = Number(`0.${match[3] ?? '0'}`)
  return minutes * 60 + seconds + fraction
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function escapeTerminalChar(char: string): string {
  if (char === ' ') return '&nbsp;'
  return escapeHtml(char)
}

export function ansiToHtml(input: string): string {
  // eslint-disable-next-line no-control-regex -- matches ANSI escape sequences
  const pieces = input.split(/(\x1b\[[0-9;]*m)/g)
  let fg = ''
  let bg = ''
  let html = ''
  for (const piece of pieces) {
    // eslint-disable-next-line no-control-regex -- matches ANSI escape sequences
    const match = /^\x1b\[([0-9;]*)m$/.exec(piece)
    if (match) {
      const parts = (match[1] ?? '').split(';').filter(Boolean).map(Number)
      if (parts[0] === 0) {
        fg = ''
        bg = ''
        continue
      }
      if (parts[0] === 38 && parts[1] === 2) fg = `color: rgb(${parts[2] ?? 0}, ${parts[3] ?? 0}, ${parts[4] ?? 0});`
      if (parts[0] === 48 && parts[1] === 2) bg = `background: rgb(${parts[2] ?? 0}, ${parts[3] ?? 0}, ${parts[4] ?? 0});`
      continue
    }
    if (!piece) continue
    html += `<span style="${fg}${bg}">${escapeHtml(piece)}</span>`
  }
  return html
}

const ASCII_PALETTE = '$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,"^`. '
const ASCII_LEN = ASCII_PALETTE.length

export function frameToAsciiHtml(frame: FramePreviewBuffer): string {
  const { width, height, data } = frame
  const rows: string[] = []
  for (let y = 0; y < height; y++) {
    let row = ''
    for (let x = 0; x < width; x++) {
      const off = (y * width + x) * 4
      const r = data[off] ?? 0
      const g = data[off + 1] ?? 0
      const b = data[off + 2] ?? 0
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
      const idx = Math.min(Math.floor(lum * ASCII_LEN), ASCII_LEN - 1)
      const char = ASCII_PALETTE[ASCII_LEN - 1 - idx] ?? ' '
      row += `<span style="color: rgb(${r}, ${g}, ${b});">${escapeTerminalChar(char)}</span>`
    }
    rows.push(row)
  }
  return rows.join('\n')
}

export function frameToAnsiHtml(frame: FramePreviewBuffer): string {
  const { width, height, data } = frame
  const rows: string[] = []
  for (let y = 0; y < height; y += 2) {
    let row = ''
    for (let x = 0; x < width; x++) {
      const topOff = (y * width + x) * 4
      const bottomOff = ((Math.min(y + 1, height - 1)) * width + x) * 4
      const tr = data[topOff] ?? 0
      const tg = data[topOff + 1] ?? 0
      const tb = data[topOff + 2] ?? 0
      const br = data[bottomOff] ?? 0
      const bg = data[bottomOff + 1] ?? 0
      const bb = data[bottomOff + 2] ?? 0
      row += `<span style="color: rgb(${tr}, ${tg}, ${tb}); background: rgb(${br}, ${bg}, ${bb});">▀</span>`
    }
    rows.push(row)
  }
  return rows.join('\n')
}

export interface TerminalViewport {
  width: number
  height: number
}

export interface TerminalGridSize {
  columns: number
  rows: number
}

export function terminalGridForViewport(viewport: TerminalViewport): TerminalGridSize {
  const columns = Math.max(24, Math.floor(Math.max(160, viewport.width - 24) / 8))
  const rows = Math.max(12, Math.floor(Math.max(120, viewport.height - 24) / 16))
  return { columns, rows }
}

export function fitTerminalStyle(viewport: TerminalViewport, grid: TerminalGridSize): { fontSize: number; lineHeight: number } {
  const widthBased = Math.max(7, Math.floor((viewport.width - 24) / Math.max(grid.columns, 1)))
  const heightBased = Math.max(7, Math.floor((viewport.height - 24) / Math.max(grid.rows, 1)))
  const fontSize = Math.min(13, widthBased, heightBased)
  return { fontSize, lineHeight: fontSize }
}

export function resizeRgbaNearest(
  srcWidth: number,
  srcHeight: number,
  src: Uint8ClampedArray,
  dstWidth: number,
  dstHeight: number,
): Uint8ClampedArray {
  if (srcWidth === dstWidth && srcHeight === dstHeight) return new Uint8ClampedArray(src)
  const output = new Uint8ClampedArray(dstWidth * dstHeight * 4)
  for (let y = 0; y < dstHeight; y++) {
    const srcY = Math.min(srcHeight - 1, Math.floor((y / dstHeight) * srcHeight))
    for (let x = 0; x < dstWidth; x++) {
      const srcX = Math.min(srcWidth - 1, Math.floor((x / dstWidth) * srcWidth))
      const srcOffset = (srcY * srcWidth + srcX) * 4
      const dstOffset = (y * dstWidth + x) * 4
      output[dstOffset] = src[srcOffset] ?? 0
      output[dstOffset + 1] = src[srcOffset + 1] ?? 0
      output[dstOffset + 2] = src[srcOffset + 2] ?? 0
      output[dstOffset + 3] = src[srcOffset + 3] ?? 255
    }
  }
  return output
}

export function isAnimatableValue(value: unknown): value is number | { track?: string; node?: string; output?: string } {
  return typeof value === 'number' || (!!value && typeof value === 'object' && (
    'track' in value || ('node' in value && 'output' in value)
  ))
}

export function parseConfigValue(value: unknown, raw: string): unknown {
  if (typeof value === 'number') {
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : value
  }
  if (typeof value === 'boolean') return raw === 'true'
  if (typeof value === 'string') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return value
  }
}

export function toHexColor(value: unknown): string | null {
  if (!Array.isArray(value) || value.length < 3) return null
  const rgb = (value as unknown[]).slice(0, 3)
  if (!rgb.every((channel): channel is number => typeof channel === 'number' && Number.isFinite(channel))) return null
  return `#${rgb.map(channel => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0')).join('')}`
}

export function fromHexColor(hex: string): [number, number, number] {
  const sanitized = hex.replace('#', '').trim()
  const expanded = sanitized.length === 3 ? sanitized.split('').map(part => part + part).join('') : sanitized
  const normalized = expanded.padEnd(6, '0').slice(0, 6)
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ]
}
