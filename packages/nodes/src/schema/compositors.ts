import type { NodeSchema } from './types.js'

const INPUTS = ['base', 'overlay', 'mask'] as const

export const COMPOSITOR_SCHEMAS: NodeSchema[] = [
  {
    impl: 'additive-blend',
    kind: 'compositor',
    label: 'Additive Blend',
    description: 'Adds the overlay onto the base, optionally masked by the luminance of a mask input.',
    inputs: INPUTS,
    params: {
      opacity: { type: 'number', default: 1, min: 0, max: 2, step: 0.01, animatable: true, description: 'Multiplier on the added overlay; values above 1 over-brighten.' },
      clamp: { type: 'boolean', default: true, description: 'Clamps the summed colour to white instead of letting it overflow.' },
    },
  },
  {
    impl: 'alpha-blend',
    kind: 'compositor',
    label: 'Alpha Blend',
    description: 'Standard "over" compositing of the overlay onto the base using its alpha, optionally masked.',
    inputs: INPUTS,
    params: {
      opacity: { type: 'number', default: 1, min: 0, max: 1, step: 0.01, animatable: true, description: 'Overlay opacity.' },
      premultiplied: { type: 'boolean', default: false, description: 'Treats the overlay colour as already multiplied by its alpha.' },
    },
  },
  {
    impl: 'difference-blend',
    kind: 'compositor',
    label: 'Difference Blend',
    description: 'Absolute difference of base and overlay, optionally masked.',
    inputs: INPUTS,
    params: {
      opacity: { type: 'number', default: 1, min: 0, max: 1, step: 0.01, animatable: true, description: 'Mix between the base (0) and the full difference (1).' },
      invert: { type: 'boolean', default: false, description: 'Inverts the resulting colour.' },
    },
  },
  {
    impl: 'multiply-blend',
    kind: 'compositor',
    label: 'Multiply Blend',
    description: 'Multiplies base by overlay, darkening it, optionally masked.',
    inputs: INPUTS,
    params: {
      opacity: { type: 'number', default: 1, min: 0, max: 1, step: 0.01, animatable: true, description: 'Mix between the base (0) and the full multiply (1).' },
    },
  },
  {
    impl: 'overlay-blend',
    kind: 'compositor',
    label: 'Overlay Blend',
    description: 'Overlay blend: multiplies the base darks and screens its lights with the overlay, optionally masked.',
    inputs: INPUTS,
    params: {
      opacity: { type: 'number', default: 1, min: 0, max: 1, step: 0.01, animatable: true, description: 'Mix between the base (0) and the full overlay blend (1).' },
    },
  },
  {
    impl: 'screen-blend',
    kind: 'compositor',
    label: 'Screen Blend',
    description: 'Screen blend that brightens the base with the overlay, optionally masked.',
    inputs: INPUTS,
    params: {
      opacity: { type: 'number', default: 1, min: 0, max: 1, step: 0.01, animatable: true, description: 'Mix between the base (0) and the full screen blend (1).' },
    },
  },
  {
    impl: 'transition',
    kind: 'compositor',
    label: 'Transition',
    description: 'Transitions from base to overlay with a dissolve, wipe, zoom, iris or flash, driven by a progress value.',
    inputs: INPUTS,
    params: {
      mode: {
        type: 'enum',
        options: ['dissolve', 'wipe-left', 'wipe-right', 'wipe-up', 'wipe-down', 'zoom-out', 'flash', 'iris', 'blinds', 'checker', 'push', 'melt'],
        default: 'dissolve',
        description: 'Transition style: blends (dissolve, flash), wipes, zoom-out and iris, blinds (slats), checker (cells flip at random), push (slides in from the right) or melt (columns drop away).',
      },
      progress: { type: 'number', default: 0, min: 0, max: 1, step: 0.01, animatable: true, description: 'Transition position from base (0) to overlay (1), usually driven by a track.' },
      easing: {
        type: 'enum',
        options: ['step', 'linear', 'smooth', 'ease-in', 'ease-out', 'ease-in-out', 'elastic', 'bounce', 'back', 'expo-in', 'expo-out'],
        default: 'smooth',
        description: 'Easing curve applied to progress.',
      },
      flashColor: { type: 'color', default: '#ffffff', description: 'Colour flashed mid-transition in flash mode.' },
    },
  },
]
