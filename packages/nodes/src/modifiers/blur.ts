import { BlurGlowModifier, type BlurGlowConfig } from './blur-glow.js'
import type { AnimatableFloat, Modifier } from '@overscan/types'

export interface BlurConfig {
  radius?: AnimatableFloat
  passes?: number
  quality?: 'box' | 'gaussian'
}

export function BlurModifier(config: Partial<BlurConfig> = {}): Modifier {
  const mapped: Partial<BlurGlowConfig> = {
    mode: 'blur',
    ...(config.radius !== undefined ? { radius: config.radius } : {}),
  }
  const node = BlurGlowModifier(mapped)

  return {
    ...node,
    id: 'blur',
    config: config,
  }
}
