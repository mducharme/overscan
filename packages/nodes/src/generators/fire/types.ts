import type { AnimatableFloat } from '@overscan/types'

export interface FireConfig {
  cooling?: AnimatableFloat
  seed?: 'noise' | 'random'
  seedIntensity?: AnimatableFloat
  seedWidth?: AnimatableFloat
  spread?: number
  wind?: AnimatableFloat
  palette?: number[][] | undefined
}

export const defaultFirePalette: number[][] = [
  [0, 0, 0],
  [80, 0, 0],
  [200, 60, 0],
  [255, 200, 80],
  [255, 255, 220],
]
