import type { AnimatableFloat } from '@overscan/types'

export interface PlasmaConfig {
  speed:   AnimatableFloat
  scale:   AnimatableFloat
  palette: number[][]   // array of [r, g, b] tuples
  complexity?: number
}

export const defaultPalette: number[][] = [
  [255,   0, 128],
  [255, 128,   0],
  [128, 255,   0],
  [  0, 255, 128],
  [  0, 128, 255],
  [128,   0, 255],
]
