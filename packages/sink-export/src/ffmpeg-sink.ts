import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { FrameBuffer, Signal, Sink } from '@overscan/types'
import { rgbStripByteLength, rgbaToRgbStrip } from './rgba-to-rgb.js'

export interface FfmpegSinkOptions {
  /** Output file, e.g. `out/plasma.mp4` — parent directory must exist or use mkdir in init. */
  outputPath: string
  /** Override encoder ffmpeg arguments after the input (`-i -`). Default: libx264 yuv420p. */
  encoderArgs?: string[]
  /** Optional audio tracks to mux and mix into the output. */
  audioTracks?: FfmpegAudioTrack[]
  /** Optional explicit output duration in seconds. */
  durationSeconds?: number
  /**
   * Animated GIF via palette filter. Audio tracks are ignored (GIF has no audio).
   */
  gif?: boolean
}

export interface FfmpegAudioTrack {
  inputPath: string
  offsetSeconds?: number
  trimSeconds?: number
  loop?: boolean
  volume?: number
}

export class FfmpegSink implements Sink {
  readonly id = 'export'

  private w = 0
  private h = 0
  private fps = 30
  private proc: ChildProcess | null = null
  private rgb: Uint8Array | null = null
  private encoderArgs: string[]
  private readonly outputPath: string
  private readonly audioTracks: FfmpegAudioTrack[]
  private readonly durationSeconds: number | undefined
  private readonly gif: boolean

  constructor(opts: FfmpegSinkOptions) {
    this.outputPath = opts.outputPath
    this.gif = opts.gif ?? false
    this.audioTracks = this.gif ? [] : (opts.audioTracks ?? [])
    this.durationSeconds = opts.durationSeconds
    this.encoderArgs = this.gif
      ? [
          '-vf',
          'split[s0][s1];[s0]palettegen=max_colors=256[p];[s1][p]paletteuse',
          '-c:v',
          'gif',
          '-loop',
          '0',
        ]
      : (opts.encoderArgs ?? ['-c:v', 'libx264', '-pix_fmt', 'yuv420p'])
  }

  async init(width: number, height: number, fps: number): Promise<void> {
    this.w = width
    this.h = height
    this.fps = fps
    const nbytes = rgbStripByteLength(width, height)
    this.rgb = new Uint8Array(nbytes)

    await mkdir(dirname(this.outputPath), { recursive: true })

    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'rawvideo',
      '-pixel_format',
      'rgb24',
      '-video_size',
      `${width}x${height}`,
      '-framerate',
      String(fps),
      '-i',
      '-',
      ...this.audioTracks.flatMap(track => [
        ...(track.loop ? ['-stream_loop', '-1'] : []),
        '-i',
        track.inputPath,
      ]),
    ]
    const filterArgs = buildAudioFilterArgs(this.audioTracks, this.durationSeconds)
    args.push(...filterArgs, '-map', '0:v:0', ...(this.audioTracks.length > 0 ? ['-map', '[aout]', '-c:a', 'aac', '-b:a', '192k'] : []))
    if (this.durationSeconds !== undefined) args.push('-t', formatSeconds(this.durationSeconds))
    args.push(...this.encoderArgs, '-y', this.outputPath)

    const proc = spawn('ffmpeg', args, {
      stdio: ['pipe', 'inherit', 'inherit'],
    })
    this.proc = proc

    await new Promise<void>((resolve, reject) => {
      proc.once('error', (err) => {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new Error('ffmpeg not found on PATH (install ffmpeg for overscan export --mp4 or --gif)'))
          return
        }
        reject(err)
      })
      proc.once('spawn', () => { resolve(); })
    })
  }

  async write(frame: FrameBuffer, _frameIndex: number, _signal: Signal): Promise<void> {
    const proc = this.proc
    const rgb = this.rgb
    const stdin = proc?.stdin
    if (!stdin?.writable || !rgb) throw new Error('FfmpegSink not initialized')

    if (frame.width !== this.w || frame.height !== this.h) {
      throw new Error(`FfmpegSink: frame ${frame.width}×${frame.height} ≠ ${this.w}×${this.h}`)
    }
    rgbaToRgbStrip(frame.data, this.w, this.h, rgb)

    await new Promise<void>((resolve, reject) => {
      stdin.write(Buffer.from(rgb.buffer, rgb.byteOffset, rgb.byteLength), (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  async flush(): Promise<void> {
    const proc = this.proc
    this.proc = null
    this.rgb = null
    if (!proc) return

    proc.stdin?.end()

    const code = await new Promise<number>((resolve, reject) => {
      proc.once('error', reject)
      proc.once('close', (c, signal) => {
        resolve(typeof c === 'number' ? c : signal ? 1 : 0)
      })
    })
    if (code !== 0) throw new Error(`ffmpeg exited with code ${String(code)}`)
  }
}

function buildAudioFilterArgs(audioTracks: FfmpegAudioTrack[], durationSeconds?: number): string[] {
  if (audioTracks.length === 0) return []
  const filters: string[] = []
  const labels: string[] = []
  for (let i = 0; i < audioTracks.length; i++) {
    const track = audioTracks[i]!
    const inputIndex = i + 1
    const label = `a${i}`
    labels.push(label)
    const chain = [
      `atrim=0:${formatSeconds(track.trimSeconds ?? durationSeconds)}`,
      'asetpts=PTS-STARTPTS',
      `volume=${formatVolume(track.volume ?? 1)}`,
    ]
    const offsetMs = Math.max(0, Math.round((track.offsetSeconds ?? 0) * 1000))
    if (offsetMs > 0) chain.push(`adelay=${offsetMs}:all=1`)
    filters.push(`[${inputIndex}:a]${chain.join(',')}[${label}]`)
  }
  if (labels.length === 1) {
    filters.push(`[${labels[0]}]anull[aout]`)
  } else {
    filters.push(`${labels.map(label => `[${label}]`).join('')}amix=inputs=${labels.length}:dropout_transition=0[aout]`)
  }
  return ['-filter_complex', filters.join(';')]
}

function formatSeconds(value?: number): string {
  const safe = Math.max(0, Number.isFinite(value) ? value! : 0)
  return safe.toFixed(3)
}

function formatVolume(value: number): string {
  const safe = Number.isFinite(value) ? value : 1
  return safe.toFixed(3)
}
