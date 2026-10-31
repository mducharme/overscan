/** Colour helpers shared by the newer effects. */

export type Rgb = [number, number, number]

/** `#rgb` or `#rrggbb` to bytes; anything unparsable falls back to `fallback`. */
export function hexToRgb(hex: string | undefined, fallback: Rgb = [255, 255, 255]): Rgb {
  if (!hex) return fallback
  const s = hex.replace('#', '')
  const n = parseInt(s.length === 3 ? s.split('').map(c => c + c).join('') : s, 16)
  if (!Number.isFinite(n) || (s.length !== 3 && s.length !== 6)) return fallback
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

/** A palette from config (`[[r, g, b], …]`), or `fallback` when missing or malformed. */
export function readPalette(value: unknown, fallback: readonly Rgb[]): Rgb[] {
  if (!Array.isArray(value)) return fallback.slice()
  const colors = value.filter((c): c is number[] => Array.isArray(c) && c.length >= 3 && c.every(x => typeof x === 'number'))
  return colors.length ? colors.map(c => [c[0]!, c[1]!, c[2]!]) : fallback.slice()
}

/** Smooth lookup along a palette: 0 is the first colour, 1 the last. */
export function samplePalette(palette: readonly Rgb[], t: number, out: Rgb = [0, 0, 0]): Rgb {
  const n = palette.length
  if (n === 0) return out
  const x = Math.max(0, Math.min(1, t)) * (n - 1)
  const i = Math.min(n - 2, Math.floor(x))
  if (n === 1 || i < 0) {
    const c = palette[0]!
    out[0] = c[0]; out[1] = c[1]; out[2] = c[2]
    return out
  }
  const f = x - i
  const a = palette[i]!
  const b = palette[i + 1]!
  out[0] = a[0] + (b[0] - a[0]) * f
  out[1] = a[1] + (b[1] - a[1]) * f
  out[2] = a[2] + (b[2] - a[2]) * f
  return out
}

export function fillRgb(data: Uint8ClampedArray, color: Rgb): void {
  for (let i = 0; i < data.length; i += 4) {
    data[i] = color[0]
    data[i + 1] = color[1]
    data[i + 2] = color[2]
    data[i + 3] = 255
  }
}

/** Bilinear read of an RGBA buffer at fractional pixel coordinates, clamped at the edges. */
export function sampleBilinear(data: Uint8ClampedArray, w: number, h: number, x: number, y: number, out: Rgb): Rgb {
  const cx = Math.max(0, Math.min(w - 1, x))
  const cy = Math.max(0, Math.min(h - 1, y))
  const x0 = Math.floor(cx)
  const y0 = Math.floor(cy)
  const x1 = Math.min(w - 1, x0 + 1)
  const y1 = Math.min(h - 1, y0 + 1)
  const fx = cx - x0
  const fy = cy - y0
  const i00 = (y0 * w + x0) * 4
  const i10 = (y0 * w + x1) * 4
  const i01 = (y1 * w + x0) * 4
  const i11 = (y1 * w + x1) * 4
  for (let c = 0; c < 3; c++) {
    const top = data[i00 + c]! + (data[i10 + c]! - data[i00 + c]!) * fx
    const bottom = data[i01 + c]! + (data[i11 + c]! - data[i01 + c]!) * fx
    out[c] = top + (bottom - top) * fy
  }
  return out
}

/** Wraps `v` into [0, n). */
export const wrap = (v: number, n: number): number => ((v % n) + n) % n
