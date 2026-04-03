import { type FrameBuffer, type Generator, type NodeContext, type Signal } from '@overscan/types'
import { VIEWPORT_REF_HEIGHT, VIEWPORT_REF_WIDTH } from '../../viewport-scale.js'

export interface GameOfLifeConfig {
  seed?: 'random' | 'glider' | 'rPentomino' | string
  seedDensity?: number
  aliveColor?: string
  deadColor?: string
  scale?: number
  speed?: number
  wrap?: boolean
  colorMode?: 'binary' | 'age' | 'palette'
  agePalette?: number[][]
}

const DEFAULT_PALETTE = [
  [26, 34, 46],
  [74, 222, 128],
  [255, 255, 255],
]

export function GameOfLifeGenerator(config: Partial<GameOfLifeConfig> = {}): Generator {
  const seed = config.seed ?? 'random'
  const seedDensity = Math.max(0.01, Math.min(1, config.seedDensity ?? 0.3))
  const aliveColor = hexToRgb(config.aliveColor ?? '#ffffff')
  const deadColor = hexToRgb(config.deadColor ?? '#000000')
  const scale = Math.max(1, Math.min(16, Math.round(config.scale ?? 6)))
  const speed = Math.max(1, Math.min(8, Math.round(config.speed ?? 1)))
  const wrap = config.wrap ?? true
  const colorMode = config.colorMode ?? 'binary'
  const agePalette = config.agePalette ?? DEFAULT_PALETTE
  let cells: Uint8Array | null = null
  let next: Uint8Array | null = null
  let ages: Uint16Array | null = null
  let cw = 0
  let ch = 0

  return {
    type: 'generator',
    id: 'game-of-life',
    renderers: ['cpu'],
    config: config as Generator['config'],
    init() {
      cells = null; next = null; ages = null; cw = 0; ch = 0
    },
    render(_ctx: NodeContext, out: FrameBuffer, _signal: Signal): void {
      const gw = Math.max(1, Math.floor(VIEWPORT_REF_WIDTH / scale))
      const gh = Math.max(1, Math.floor(VIEWPORT_REF_HEIGHT / scale))
      if (!cells || !next || !ages || cw !== gw || ch !== gh) {
        cw = gw; ch = gh
        cells = new Uint8Array(gw * gh)
        next = new Uint8Array(gw * gh)
        ages = new Uint16Array(gw * gh)
        seedCells(cells, gw, gh, seed, seedDensity)
      }
      let state = cells!
      let nextState = next!
      const ageState = ages!
      for (let step = 0; step < speed; step++) {
        for (let y = 0; y < gh; y++) {
          for (let x = 0; x < gw; x++) {
            const i = y * gw + x
            const live = state[i] ?? 0
            let n = 0
            for (let yy = -1; yy <= 1; yy++) {
              for (let xx = -1; xx <= 1; xx++) {
                if (xx === 0 && yy === 0) continue
                let nx = x + xx
                let ny = y + yy
                if (wrap) {
                  nx = (nx + gw) % gw
                  ny = (ny + gh) % gh
                }
                if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue
                n += state[ny * gw + nx] ?? 0
              }
            }
            const alive = live ? (n === 2 || n === 3 ? 1 : 0) : (n === 3 ? 1 : 0)
            nextState[i] = alive
            ageState[i] = alive ? ((live ? (ageState[i] ?? 0) : 0) + 1) : 0
          }
        }
        const temp: Uint8Array = state
        state = nextState
        nextState = temp
        cells = state
        next = nextState
      }
      renderCells(out, state, ageState, gw, gh, colorMode, aliveColor, deadColor, agePalette)
    },
    destroy() {
      cells = null; next = null; ages = null
    },
  }
}

function seedCells(cells: Uint8Array, w: number, h: number, seed: string, density: number): void {
  cells.fill(0)
  if (seed === 'glider') {
    const x = Math.floor(w / 2), y = Math.floor(h / 2)
    setAlive(cells, w, h, x, y); setAlive(cells, w, h, x + 1, y); setAlive(cells, w, h, x - 1, y)
    setAlive(cells, w, h, x + 1, y - 1); setAlive(cells, w, h, x, y - 2)
    return
  }
  if (seed === 'rPentomino') {
    const x = Math.floor(w / 2), y = Math.floor(h / 2)
    setAlive(cells, w, h, x, y); setAlive(cells, w, h, x + 1, y); setAlive(cells, w, h, x - 1, y - 1)
    setAlive(cells, w, h, x, y - 1); setAlive(cells, w, h, x, y + 1)
    return
  }
  for (let i = 0; i < cells.length; i++) cells[i] = Math.random() < density ? 1 : 0
}

function setAlive(cells: Uint8Array, w: number, h: number, x: number, y: number): void {
  if (x >= 0 && y >= 0 && x < w && y < h) cells[y * w + x] = 1
}

function renderCells(
  out: FrameBuffer,
  cells: Uint8Array,
  ages: Uint16Array,
  gw: number,
  gh: number,
  colorMode: 'binary' | 'age' | 'palette',
  aliveColor: [number, number, number],
  deadColor: [number, number, number],
  agePalette: number[][],
): void {
  const { width: w, height: h, data } = out
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = Math.min(gw - 1, Math.floor(((x + 0.5) * gw) / w))
      const gy = Math.min(gh - 1, Math.floor(((y + 0.5) * gh) / h))
      const i = gy * gw + gx
      const alive = cells[i] ?? 0
      const c = alive
        ? (colorMode === 'binary' ? aliveColor : colorMode === 'age' ? mixRgb(deadColor, aliveColor, Math.min(1, (ages[i] ?? 0) / 12)) : samplePalette(agePalette, Math.min(1, (ages[i] ?? 0) / 12)))
        : deadColor
      const o = (y * w + x) * 4
      data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255
    }
  }
}

function samplePalette(palette: number[][], t: number): [number, number, number] {
  const colors = palette.length > 1 ? palette : DEFAULT_PALETTE
  const scaled = Math.max(0, Math.min(1, t)) * (colors.length - 1)
  const idx = Math.min(colors.length - 2, Math.floor(scaled))
  const frac = scaled - idx
  const a = colors[idx] ?? colors[0] ?? DEFAULT_PALETTE[0]!
  const b = colors[idx + 1] ?? a
  return mixRgb([a[0] ?? 0, a[1] ?? 0, a[2] ?? 0], [b[0] ?? 0, b[1] ?? 0, b[2] ?? 0], frac)
}

function mixRgb(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ]
}

function hexToRgb(hex: string): [number, number, number] {
  const s = hex.replace('#', '')
  const n = parseInt(s.length === 3 ? s.split('').map(c => c + c).join('') : s, 16)
  return [Number.isFinite(n) ? (n >> 16) & 0xff : 255, Number.isFinite(n) ? (n >> 8) & 0xff : 255, Number.isFinite(n) ? n & 0xff : 255]
}
