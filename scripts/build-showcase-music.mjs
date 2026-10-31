#!/usr/bin/env node
/**
 * Synthesises the showcase soundtrack: 52 bars at 128 BPM in A minor (intro, drop, breakdown, drop,
 * outro), written to examples/showcase/music.mp3. Deterministic; needs ffmpeg on PATH to encode.
 * The section boundaries here are the ones examples/showcase.demo.json cuts on.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const OUT = join(ROOT, 'examples', 'showcase', 'music.mp3')

const RATE = 32000
const BPM = 128
const BEAT = 60 / BPM
const BAR = BEAT * 4
const BARS = 52
const LENGTH = BARS * BAR + 2 // a little tail for the last echoes
const N = Math.ceil(LENGTH * RATE)
const out = new Float32Array(N)

// Song map, in bars.
const INTRO = [0, 8]
const DROP1 = [8, 24]
const BREAK = [24, 32]
const DROP2 = [32, 48]
const OUTRO = [48, 52]
const inBars = (bar, [a, b]) => bar >= a && bar < b

// A minor: Am F C G in the drops, F G Em Am (two bars each) in the breakdown.
const midi = n => 440 * 2 ** ((n - 69) / 12)
const CHORDS = { Am: [57, 60, 64], F: [53, 57, 60], C: [48, 52, 55], G: [55, 59, 62], Em: [52, 55, 59] }
const chordAt = bar => {
  if (inBars(bar, BREAK)) return ['F', 'G', 'Em', 'Am'][Math.floor((bar - BREAK[0]) / 2) % 4]
  return ['Am', 'F', 'C', 'G'][bar % 4]
}

// Deterministic noise.
let seed = 12345
const noise = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 2147483648 - 1
}

const add = (start, samples, fn) => {
  const i0 = Math.max(0, Math.floor(start * RATE))
  const i1 = Math.min(N, i0 + samples)
  for (let i = i0; i < i1; i++) out[i] += fn((i - i0) / RATE, i)
}

// Kick drum also drives the sidechain envelope (how much the bass and pads duck).
const kicks = []
function kick(t, gain = 1) {
  kicks.push(t)
  let phase = 0
  add(t, RATE * 0.45, x => {
    const f = 45 + 120 * Math.exp(-x * 28)
    phase += (2 * Math.PI * f) / RATE
    return Math.sin(phase) * Math.exp(-x * 7) * 0.95 * gain + (x < 0.004 ? noise() * 0.3 * gain : 0)
  })
}
function snare(t, gain = 1) {
  let lp = 0
  add(t, RATE * 0.3, x => {
    lp += 0.55 * (noise() - lp)
    return (lp * Math.exp(-x * 14) * 0.55 + Math.sin(2 * Math.PI * 185 * x) * Math.exp(-x * 30) * 0.35) * gain
  })
}
function hat(t, open = false, gain = 1) {
  let prev = 0
  add(t, RATE * (open ? 0.25 : 0.06), x => {
    const n = noise()
    const hp = n - prev
    prev = n
    return hp * Math.exp(-x * (open ? 14 : 70)) * 0.16 * gain
  })
}
function crash(t) {
  let prev = 0
  add(t, RATE * 2, x => {
    const n = noise()
    const hp = n - prev * 0.6
    prev = n
    return hp * Math.exp(-x * 2.2) * 0.2
  })
}
/** A noise sweep rising into the next section. */
function riser(t, seconds) {
  let lp = 0
  add(t, RATE * seconds, x => {
    const k = x / seconds
    lp += (0.02 + 0.6 * k * k) * (noise() - lp)
    return lp * k * k * 0.5
  })
}

/** Saw bass through a one-pole low-pass; `cut` 0–1 opens the filter. */
function bass(t, note, len, cut = 0.25) {
  const f = midi(note)
  let phase = 0
  let lp = 0
  add(t, RATE * len, x => {
    phase = (phase + f / RATE) % 1
    lp += cut * ((phase * 2 - 1) - lp)
    const env = Math.min(1, x * 200) * Math.exp(-x * 3)
    return lp * env * 0.5
  })
}
/** Pulse arpeggio note with a quick pluck envelope. */
function pluck(t, note, len, gain = 1, bright = 0.5) {
  const f = midi(note)
  let phase = 0
  let lp = 0
  add(t, RATE * len, x => {
    phase = (phase + f / RATE) % 1
    const sq = phase < 0.35 ? 1 : -1
    lp += (0.08 + bright * 0.5 * Math.exp(-x * 9)) * (sq - lp)
    return lp * Math.min(1, x * 300) * Math.exp(-x * 6) * 0.17 * gain
  })
}
/** Detuned saw pad, slow attack and release, filtered. */
function pad(t, notes, len, gain = 1, cut = 0.05) {
  const voices = notes.flatMap(n => [midi(n) * 0.997, midi(n) * 1.003, midi(n - 12)])
  const phases = voices.map(() => 0)
  let lp = 0
  add(t, RATE * (len + 0.8), x => {
    let s = 0
    for (let v = 0; v < voices.length; v++) {
      phases[v] = (phases[v] + voices[v] / RATE) % 1
      s += phases[v] * 2 - 1
    }
    lp += cut * (s / voices.length - lp)
    const env = Math.min(1, x / 0.6) * (x > len ? Math.exp(-(x - len) * 5) : 1)
    return lp * env * 0.55 * gain
  })
}
/** Lead: a soft square with vibrato. */
function lead(t, note, len) {
  const f = midi(note)
  let phase = 0
  let lp = 0
  add(t, RATE * len, x => {
    phase = (phase + (f * (1 + 0.004 * Math.sin(x * 32))) / RATE) % 1
    lp += 0.15 * ((phase < 0.5 ? 1 : -1) - lp)
    const env = Math.min(1, x * 60) * (x > len - 0.05 ? Math.max(0, (len - x) / 0.05) : 1)
    return lp * env * 0.12
  })
}

// Arrangement.
const ARP = [0, 1, 2, 1, 0, 2, 1, 2]
const MELODY = [76, 74, 72, 74, 76, 79, 76, 74] // one note per beat across two bars
for (let bar = 0; bar < BARS; bar++) {
  const t0 = bar * BAR
  const chord = CHORDS[chordAt(bar)]
  const drop = inBars(bar, DROP1) || inBars(bar, DROP2)
  const breakdown = inBars(bar, BREAK)
  const intro = inBars(bar, INTRO)

  // Pads: everywhere but the drops, where they sit low under the bass.
  if (!breakdown || (bar - BREAK[0]) % 2 === 0) {
    pad(t0, chord, breakdown ? BAR * 2 : BAR, drop ? 0.45 : 1, intro ? 0.02 + 0.06 * (bar / 8) : 0.06)
  }

  // Arpeggio: from bar 4 of the intro, through the drops; half speed in the breakdown.
  if ((intro && bar >= 4) || drop || breakdown || inBars(bar, OUTRO)) {
    const steps = breakdown ? 8 : 16
    for (let s = 0; s < steps; s++) {
      const note = chord[ARP[s % 8]] + 12 + (s >= 8 && drop ? 12 : 0)
      const fade = inBars(bar, OUTRO) ? 1 - (bar - OUTRO[0]) / 4 : 1
      pluck(t0 + s * (BAR / steps), note, BAR / steps * 1.5, (intro ? (bar - 3) / 5 : 1) * fade, drop ? 0.8 : 0.4)
      // Dotted-eighth echo.
      pluck(t0 + s * (BAR / steps) + BEAT * 0.75, note, BAR / steps * 1.5, 0.35 * fade, 0.3)
    }
  }

  if (drop) {
    for (let b = 0; b < 4; b++) {
      kick(t0 + b * BEAT)
      hat(t0 + b * BEAT + BEAT / 2, true)
      for (let s = 0; s < 4; s++) hat(t0 + b * BEAT + s * BEAT / 4, false, s % 2 ? 0.6 : 1)
    }
    snare(t0 + BEAT)
    snare(t0 + BEAT * 3)
    // Fill on the last bar of each 4-bar phrase.
    if (bar % 4 === 3) for (let s = 0; s < 4; s++) snare(t0 + BEAT * 3 + s * BEAT / 4, 0.5 + s * 0.15)
    // Rolling eighth-note bass, root and octave.
    for (let e = 0; e < 8; e++) bass(t0 + e * BEAT / 2, chord[0] - 24 + (e % 2 ? 12 : 0), BEAT / 2 * 0.9, 0.18 + (inBars(bar, DROP2) ? 0.1 : 0))
    if (inBars(bar, DROP2)) {
      const m = (bar - DROP2[0]) % 2
      for (let b = 0; b < 4; b++) lead(t0 + b * BEAT, MELODY[m * 4 + b], BEAT * 0.95)
    }
  }
  if (intro && bar >= 6) for (let b = 0; b < 4; b++) hat(t0 + b * BEAT + BEAT / 2, false, (bar - 5) / 3)
  if (breakdown && bar >= BREAK[0] + 4) for (let b = 0; b < 4; b += 2) kick(t0 + b * BEAT, 0.5)
}
// Section accents.
riser(6 * BAR, 2 * BAR)
riser(30 * BAR, 2 * BAR)
for (const bar of [8, 24, 32, 48]) crash(bar * BAR)
kick(48 * BAR, 1.1)

// Sidechain: duck everything but the kick itself for a moment after each kick.
// (Approximation: applied to the whole mix, then the kicks are added again on top.)
const duck = new Float32Array(N).fill(1)
for (const t of kicks) {
  const i0 = Math.floor(t * RATE)
  for (let i = i0; i < Math.min(N, i0 + RATE * 0.25); i++) duck[i] = Math.min(duck[i], 0.45 + 0.55 * ((i - i0) / (RATE * 0.25)) ** 2)
}
for (let i = 0; i < N; i++) out[i] *= duck[i]
const kickOnly = new Float32Array(N)
for (const t of kicks) {
  let phase = 0
  const i0 = Math.floor(t * RATE)
  for (let i = i0; i < Math.min(N, i0 + RATE * 0.45); i++) {
    const x = (i - i0) / RATE
    phase += (2 * Math.PI * (45 + 120 * Math.exp(-x * 28))) / RATE
    kickOnly[i] += Math.sin(phase) * Math.exp(-x * 7) * 0.5
  }
}

// Master: soft clip and normalise.
let peak = 0
for (let i = 0; i < N; i++) {
  out[i] = Math.tanh((out[i] + kickOnly[i]) * 1.2)
  peak = Math.max(peak, Math.abs(out[i]))
}
const wav = Buffer.alloc(44 + N * 2)
wav.write('RIFF', 0); wav.writeUInt32LE(36 + N * 2, 4); wav.write('WAVEfmt ', 8)
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(RATE, 24)
wav.writeUInt32LE(RATE * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(N * 2, 40)
for (let i = 0; i < N; i++) wav.writeInt16LE(Math.round((out[i] / peak) * 0.89 * 32767), 44 + i * 2)

const dir = mkdtempSync(join(tmpdir(), 'overscan-music-'))
try {
  const tmp = join(dir, 'music.wav')
  writeFileSync(tmp, wav)
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, '-c:a', 'libmp3lame', '-q:a', '4', OUT], { stdio: 'inherit' })
  if (r.status !== 0) throw new Error('ffmpeg failed (is it on PATH, with libmp3lame?)')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
console.log(`build-showcase-music: wrote ${OUT.slice(ROOT.length + 1)} (${(N / RATE).toFixed(1)} s, ${BARS} bars at ${BPM} BPM)`)
