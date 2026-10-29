import type { Signal } from '@overscan/types'

/** Effects were tuned at 30 fps; per-frame rates and fixed-step simulations are expressed against it. */
export const REFERENCE_FPS = 30

/** Longest frame gap honoured at once, so a seek or stall does not explode per-frame rates. */
const MAX_FRAME_DT = 0.25

/**
 * How many reference frames this frame covers: scale per-frame motion by it, and raise per-frame
 * decays to its power. 1 at 30 fps, 0.5 at 60 fps. The first frame (dt 0) counts as one.
 */
export function frameSteps(signal: Signal): number {
  return signal.dt > 0 ? Math.min(signal.dt, MAX_FRAME_DT) * REFERENCE_FPS : 1
}

/** Catch-up limit: a jump longer than this only simulates its last 10 seconds (a warm-up, not exact). */
const MAX_CATCH_UP_TICKS = REFERENCE_FPS * 10

/**
 * Drives a fixed-step simulation from the timeline: tick k runs at time k / 30, independent of the
 * render frame rate. Seeking backwards resets the simulation and replays it, so a given time
 * always shows the same state (exactly, for targets within the catch-up limit).
 */
export class FixedStepClock {
  private next = 0

  reset(): void {
    this.next = 0
  }

  advance(t: number, resetState: () => void, step: (tickTime: number) => void): void {
    const target = Math.floor(t * REFERENCE_FPS + 1e-6) + 1
    if (target < this.next) {
      resetState()
      this.next = 0
    }
    if (target - this.next > MAX_CATCH_UP_TICKS) this.next = target - MAX_CATCH_UP_TICKS
    // `k * (1 / fps)` mirrors how render loops compute `t = frame * frameSec`, keeping 30 fps output unchanged.
    for (; this.next < target; this.next++) step(this.next * (1 / REFERENCE_FPS))
  }
}
