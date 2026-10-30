import type { Signal, SignalSource } from '@overscan/types'

export interface AudioAnalyserConfig {
  /** Ignored in browser — no filesystem access. Present for schema parity with the Node.js version. */
  src?: string
  bufferSize?: number
  bpmEstimate?: number
  features?: string[]
}

const OUTPUTS = [
  'rms', 'spectral', 'beat', 'zcr',
  'chroma-0', 'chroma-1', 'chroma-2', 'chroma-3', 'chroma-4', 'chroma-5',
  'chroma-6', 'chroma-7', 'chroma-8', 'chroma-9', 'chroma-10', 'chroma-11',
  'mfcc-0', 'mfcc-1', 'mfcc-2', 'mfcc-3', 'mfcc-4', 'mfcc-5', 'mfcc-6',
  'mfcc-7', 'mfcc-8', 'mfcc-9', 'mfcc-10', 'mfcc-11', 'mfcc-12',
]

/**
 * Browser-safe AudioAnalyserSource. Cannot load audio files from disk — always
 * runs the synthetic beat fallback. BPM-locked beat output is still useful for
 * driving effects in browser/Studio without a real audio pipeline.
 */
export function AudioAnalyserSource(config: Partial<AudioAnalyserConfig> = {}): SignalSource {
  const bpmEstimate = config.bpmEstimate ?? 120

  return {
    type:    'signal',
    id:      'audio',
    outputs: OUTPUTS,
    config:  config,
    init:    () => {},
    destroy: () => {},
    tick(signal: Signal): Record<string, number> {
      const t = signal.t * 8
      const out: Record<string, number> = {
        rms:      0,
        spectral: 0,
        beat:     Math.sin(t * Math.PI * (bpmEstimate / Math.max(1, signal.bpm))) * 0.5 + 0.5,
        zcr:      0,
      }
      for (let i = 0; i < 12; i++) out[`chroma-${i}`] = 0
      for (let i = 0; i < 13; i++) out[`mfcc-${i}`] = 0
      return out
    },
  }
}
