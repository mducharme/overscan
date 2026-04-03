import { existsSync, readFileSync } from 'node:fs'
import type { Signal, SignalSource } from '@overscan/types'

export interface AudioAnalyserConfig {
  /** Path to 16-bit PCM WAV (mono or stereo). */
  src?: string
  bufferSize?: number
  bpmEstimate?: number
  features?: string[]
}

function decodeWav(buf: Buffer): { samples: Float32Array; channels: number; rate: number } | null {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') return null
  let off = 12
  let fmt = 0
  let ch = 1
  let rate = 44100
  let bits = 16
  let dataOff = 0
  let dataSize = 0
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const sz = buf.readUInt32LE(off + 4)
    const start = off + 8
    if (id === 'fmt ') {
      fmt = buf.readUInt16LE(start)
      ch = buf.readUInt16LE(start + 2)
      rate = buf.readUInt32LE(start + 4)
      bits = buf.readUInt16LE(start + 14)
    }
    if (id === 'data') {
      dataOff = start
      dataSize = sz
      break
    }
    off += 8 + sz
  }
  if (fmt !== 1 || bits !== 16 || dataSize < 4) return null
  const frameCount = Math.floor(dataSize / (2 * ch))
  const f = new Float32Array(frameCount * ch)
  for (let i = 0; i < frameCount * ch; i++) {
    f[i] = buf.readInt16LE(dataOff + i * 2) / 32768
  }
  return { samples: f, channels: ch, rate }
}

export function AudioAnalyserSource(config: Partial<AudioAnalyserConfig> = {}): SignalSource {
  const win = Math.max(128, Math.min(2048, config.bufferSize ?? 512))
  const bpmEstimate = config.bpmEstimate ?? 120
  let mono: Float32Array | null = null
  let sampleRate = 44100
  let loaded = false

  return {
    type:     'signal',
    id:       'audio',
    outputs:  ['rms', 'spectral', 'beat', 'zcr', 'chroma-0', 'chroma-1', 'chroma-2', 'chroma-3', 'chroma-4', 'chroma-5', 'chroma-6', 'chroma-7', 'chroma-8', 'chroma-9', 'chroma-10', 'chroma-11', 'mfcc-0', 'mfcc-1', 'mfcc-2', 'mfcc-3', 'mfcc-4', 'mfcc-5', 'mfcc-6', 'mfcc-7', 'mfcc-8', 'mfcc-9', 'mfcc-10', 'mfcc-11', 'mfcc-12'],
    config:   config as SignalSource['config'],
    init:     () => {
      const path = config.src
      if (!path || !existsSync(path)) {
        mono = null
        loaded = false
        return
      }
      const raw = readFileSync(path)
      const dec = decodeWav(raw)
      if (!dec) {
        mono = null
        loaded = false
        return
      }
      sampleRate = dec.rate
      if (dec.channels === 1) {
        mono = dec.samples
      } else {
        const n = Math.floor(dec.samples.length / dec.channels)
        mono = new Float32Array(n)
        for (let i = 0; i < n; i++) {
          let s = 0
          for (let c = 0; c < dec.channels; c++) {
            s += dec.samples[i * dec.channels + c] ?? 0
          }
          mono[i] = s / dec.channels
        }
      }
      loaded = true
    },
    destroy: () => {
      mono = null
    },
    tick(signal: Signal) {
      if (!loaded || !mono || mono.length < win) {
        const t = signal.t * 8
        const fallback = {
          rms:      0,
          spectral: 0,
          beat:     (Math.sin(t * Math.PI * (bpmEstimate / Math.max(1, signal.bpm))) * 0.5 + 0.5),
          zcr:      0,
        }
        for (let i = 0; i < 12; i++) (fallback as Record<string, number>)[`chroma-${i}`] = 0
        for (let i = 0; i < 13; i++) (fallback as Record<string, number>)[`mfcc-${i}`] = 0
        return fallback
      }
      const pos = Math.floor(signal.t * sampleRate)
      const wrap = ((pos % mono.length) + mono.length) % mono.length
      let rms = 0
      let centroidNum = 0
      let centroidDen = 0
      let zc = 0
      const chroma = new Array<number>(12).fill(0)
      const mfcc = new Array<number>(13).fill(0)
      let prev = mono[wrap] ?? 0
      for (let i = 0; i < win; i++) {
        const s = mono[(wrap + i) % mono.length] ?? 0
        rms += s * s
        const m = Math.abs(s)
        centroidNum += i * m
        centroidDen += m
        if ((s >= 0) !== (prev >= 0)) zc++
        prev = s
        const band = Math.min(12, Math.floor((i / win) * 13))
        mfcc[band] = (mfcc[band] ?? 0) + s
        const chromaIdx = Math.floor((i / win) * 12) % 12
        chroma[chromaIdx] = (chroma[chromaIdx] ?? 0) + m
      }
      rms = Math.sqrt(rms / win)
      const spec = centroidDen > 1e-8 ? centroidNum / centroidDen / win : 0
      const env = Math.min(1, rms * 6)
      const beat = Math.sin(signal.beat * Math.PI * 2) * 0.5 + 0.5
      const out: Record<string, number> = {
        rms:      Math.min(1, rms * 4),
        spectral: Math.min(1, spec * 4),
        beat:     Math.max(env, beat * 0.3),
        zcr:      Math.min(1, zc / win),
      }
      const chromaMax = Math.max(1e-6, ...chroma)
      for (let i = 0; i < 12; i++) out[`chroma-${i}`] = Math.min(1, (chroma[i] ?? 0) / chromaMax)
      for (let i = 0; i < 13; i++) out[`mfcc-${i}`] = Math.max(-1, Math.min(1, (mfcc[i] ?? 0) / Math.max(1, win / 16)))
      return out
    },
  }
}
