import { BlurGlowModifier, type BlurGlowConfig } from './blur-glow.js'
import type { LooseString, AnimatableFloat, Modifier } from '@overscan/types'

export interface GlowConfig {
  radius?: AnimatableFloat
  strength?: AnimatableFloat
  threshold?: AnimatableFloat
  color?: LooseString<'auto'>
  passes?: number
}

export function GlowModifier(config: Partial<GlowConfig> = {}): Modifier {
  const mapped: Partial<BlurGlowConfig> = {
    mode: 'glow',
    ...(config.radius !== undefined ? { radius: config.radius } : {}),
    ...(config.strength !== undefined ? { glowStrength: config.strength } : {}),
  }
  const node = BlurGlowModifier(mapped)

  return {
    ...node,
    id: 'glow',
    config: config,
  }
}
