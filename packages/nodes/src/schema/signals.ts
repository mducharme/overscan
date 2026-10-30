import type { NodeSchema } from './types.js'

export const SIGNAL_SCHEMAS: NodeSchema[] = [
  {
    impl: 'audio-analyser',
    kind: 'signal',
    label: 'Audio Analyser',
    description: 'Analyses a WAV file in sync with the timeline and outputs loudness, brightness, beat, zero-crossing, chroma and MFCC-style bands.',
    outputs: [
      'rms', 'spectral', 'beat', 'zcr',
      'chroma-0', 'chroma-1', 'chroma-2', 'chroma-3', 'chroma-4', 'chroma-5', 'chroma-6', 'chroma-7', 'chroma-8', 'chroma-9', 'chroma-10', 'chroma-11',
      'mfcc-0', 'mfcc-1', 'mfcc-2', 'mfcc-3', 'mfcc-4', 'mfcc-5', 'mfcc-6', 'mfcc-7', 'mfcc-8', 'mfcc-9', 'mfcc-10', 'mfcc-11', 'mfcc-12',
    ],
    params: {
      src: { type: 'asset', kind: 'audio', description: '16-bit PCM WAV file (mono or stereo) to analyse.' },
      bufferSize: { type: 'integer', default: 512, min: 128, max: 2048, description: 'Analysis window length in samples.' },
      bpmEstimate: { type: 'number', default: 120, min: 40, max: 240, step: 1, description: 'Tempo of the synthetic beat output used when no audio is loaded.' },
    },
    deprecated: ['features'],
  },
  {
    impl: 'lfo',
    kind: 'signal',
    label: 'LFO',
    description: 'Low-frequency oscillator producing a periodic wave (or stepped random values) plus its phase.',
    outputs: ['value', 'phase'],
    params: {
      shape: { type: 'enum', options: ['sine', 'triangle', 'square', 'sawtooth', 'ramp', 'random'], default: 'sine', description: 'Waveform; random holds a new value each cycle.' },
      rate: { type: 'json', default: 1, description: 'Speed in Hz (a number or track reference), or { bars: n } for one cycle every n bars at the current BPM.' },
      phase: { type: 'number', default: 0, min: 0, max: 1, step: 0.01, description: 'Starting phase offset in cycles.' },
      bipolar: { type: 'boolean', default: true, description: 'Outputs -1…1 when on, 0…1 when off (before amplitude and offset).' },
      amplitude: { type: 'number', default: 1, min: 0, max: 10, step: 0.01, animatable: true, description: 'Multiplier applied to the wave.' },
      offset: { type: 'number', default: 0, min: -10, max: 10, step: 0.01, animatable: true, description: 'Value added after the amplitude.' },
      smooth: { type: 'number', default: 0, min: 0, max: 1, step: 0.01, description: 'Per-tick smoothing of the output (0 = none, near 1 = very slow).' },
      randomSeed: { type: 'integer', default: 1, description: 'Seed for the random shape; vary it to decorrelate identical LFOs.' },
    },
  },
  {
    impl: 'noise',
    kind: 'signal',
    label: 'Noise',
    description: 'Smoothed random signal that picks a new target value at a fixed rate.',
    outputs: ['value', 'bipolar'],
    params: {
      frequency: { type: 'number', default: 3, min: 0.1, max: 30, step: 0.1, animatable: true, description: 'New random targets per second.' },
      smoothing: { type: 'number', default: 0.85, min: 0, max: 1, step: 0.01, description: 'How slowly the value glides towards each target (0 = jumps).' },
      seed: { type: 'integer', default: 1, description: 'Random seed; vary it to decorrelate identical nodes.' },
    },
  },
]
