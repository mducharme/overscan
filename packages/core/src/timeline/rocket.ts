import type { RocketTrack, RocketInterpolation } from '@overscan/types'

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t)
}

function cubicIn(t: number): number {
  return t * t * t
}

function cubicOut(t: number): number {
  const u = 1 - t
  return 1 - u * u * u
}

function cubicInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/** Rough elastic (improvement plan §3.1). */
function elastic(t: number): number {
  if (t === 0 || t === 1) return t
  const p = 0.3
  const s = p / 4
  return Math.pow(2, -10 * t) * Math.sin(((t - s) * (Math.PI * 2)) / p) + 1
}

function bounce(t: number): number {
  const n1 = 7.5625
  const d1 = 2.75
  if (t < 1 / d1) return n1 * t * t
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375
  return n1 * (t -= 2.625 / d1) * t + 0.984375
}

function back(t: number): number {
  const c1 = 1.70158
  const c3 = c1 + 1
  return c3 * t * t * t - c1 * t * t
}

function expoIn(t: number): number {
  return t === 0 ? 0 : Math.pow(2, 10 * t - 10)
}

function expoOut(t: number): number {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t)
}

function applyEasing(t: number, mode: RocketInterpolation): number {
  const x = Math.min(1, Math.max(0, t))
  switch (mode) {
    case 'step': return 0
    case 'linear': return x
    case 'smooth': return smoothstep(x)
    case 'ease-in': return cubicIn(x)
    case 'ease-out': return cubicOut(x)
    case 'ease-in-out': return cubicInOut(x)
    case 'elastic': return elastic(x)
    case 'bounce': return bounce(x)
    case 'back': return back(x)
    case 'expo-in': return expoIn(x)
    case 'expo-out': return expoOut(x)
    default: return x
  }
}

function interpolate(a: number, b: number, t: number, mode: RocketInterpolation): number {
  const x = Math.min(1, Math.max(0, t))
  if (mode === 'step') return a
  const e = applyEasing(x, mode)
  return a + (b - a) * e
}

export class RocketTimeline {
  private readonly tracks = new Map<string, RocketTrack>()

  load(tracks: RocketTrack[]): void {
    this.tracks.clear()
    for (const track of tracks) {
      this.tracks.set(track.name, track)
    }
  }

  resolve(row: number): Record<string, number> {
    const result: Record<string, number> = {}
    for (const [name, track] of this.tracks) {
      result[name] = this.valueAt(track, row)
    }
    return result
  }

  private valueAt(track: RocketTrack, row: number): number {
    const keys = track.keys
    if (keys.length === 0) return 0

    const first = keys[0]
    const last = keys[keys.length - 1]
    if (!first || !last) return 0
    if (row <= first.row) return first.value
    if (row >= last.row) return last.value

    let lo = 0
    let hi = keys.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      const midKey = keys[mid]
      if (midKey && midKey.row <= row) lo = mid
      else hi = mid
    }

    const keyA = keys[lo]
    const keyB = keys[hi]
    if (!keyA || !keyB) return 0

    const t = (row - keyA.row) / (keyB.row - keyA.row)
    return interpolate(keyA.value, keyB.value, t, keyA.interpolation)
  }

  static timeToRow(t: number, bpm: number, rowsPerBeat: number): number {
    return t * (bpm / 60) * rowsPerBeat
  }
}
