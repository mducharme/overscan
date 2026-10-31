import { describe, expect, it } from 'vitest'
import type { FrameBuffer, Generator, Modifier, NodeContext, Signal } from '@overscan/types'
import { TransitionCompositor } from './compositors/transition.js'
import { DotTunnelGenerator } from './generators/dot-tunnel/index.js'
import { ImageGenerator } from './generators/image/index.js'
import { KefrensGenerator } from './generators/kefrens/index.js'
import { ParticlesGenerator } from './generators/particles/index.js'
import { builtinMesh, cross, dot, sub, type MeshName } from './generators/polygon/mesh.js'
import { PolygonGenerator } from './generators/polygon/index.js'
import { BumpModifier } from './modifiers/bump.js'
import { bayerMatrix, DitherModifier } from './modifiers/dither.js'
import { RadialBlurModifier } from './modifiers/radial-blur.js'
import { UvMapModifier } from './modifiers/uv-map.js'
import { WobbleModifier } from './modifiers/wobble.js'

const W = 96
const H = 54
const ctx: NodeContext = { canvas: null, ctx2d: null, gl: null, width: W, height: H } as NodeContext
const buffer = (): FrameBuffer => ({ width: W, height: H, data: new Uint8ClampedArray(W * H * 4) }) as FrameBuffer
const signal = (t: number): Signal => ({ t, dt: 1 / 30, frame: Math.round(t * 30), tracks: {}, sources: {} }) as unknown as Signal
const render = (node: Generator, t = 1.3): Uint8ClampedArray => {
  const out = buffer()
  node.render(ctx, out, signal(t))
  return out.data
}
const apply = (node: Modifier, input: FrameBuffer, t = 1.3): Uint8ClampedArray => {
  const out = buffer()
  node.apply(ctx, input, out, signal(t))
  return out.data
}
const lit = (data: Uint8ClampedArray): number => {
  let n = 0
  for (let i = 0; i < data.length; i += 4) if (data[i]! + data[i + 1]! + data[i + 2]! > 60 && data[i + 3]! > 0) n++
  return n / (data.length / 4)
}
/** A soft gradient with a bright square: something for modifiers to work on. */
function testInput(): FrameBuffer {
  const b = buffer()
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4
      const square = x > 30 && x < 60 && y > 15 && y < 40
      b.data[o] = square ? 250 : x * 2; b.data[o + 1] = square ? 240 : y * 3; b.data[o + 2] = 120; b.data[o + 3] = 255
    }
  }
  return b
}

describe('new generators', () => {
  const generators: [string, () => Generator][] = [
    ['image', () => ImageGenerator({ text: 'HI' })],
    ['kefrens', () => KefrensGenerator()],
    ['dot-tunnel', () => DotTunnelGenerator()],
    ['particles fountain', () => ParticlesGenerator()],
    ['particles explosion', () => ParticlesGenerator({ mode: 'explosion' })],
    ['particles vortex', () => ParticlesGenerator({ mode: 'vortex' })],
    ['particles attractor', () => ParticlesGenerator({ mode: 'attractor', count: 5000 })],
    ['polygon', () => PolygonGenerator()],
    ['polygon envmap rubber', () => PolygonGenerator({ shading: 'envmap', rubber: 0.4, mesh: 'sphere' })],
  ]
  for (const [name, make] of generators) {
    it(`${name} draws something, and the same frame every time`, () => {
      const a = render(make())
      expect(lit(a)).toBeGreaterThan(0.002)
      expect(render(make())).toEqual(a)
    })
  }

  it('particles depend on time only, not on the frames rendered before', () => {
    const node = ParticlesGenerator({ mode: 'fountain' })
    render(node, 0.4)
    render(node, 3.1)
    expect(render(node, 1.7)).toEqual(render(ParticlesGenerator({ mode: 'fountain' }), 1.7))
  })

  it('image is transparent around the logo and opaque on it', () => {
    const data = render(ImageGenerator({ text: 'X', scale: 0.5 }))
    expect(data[3]).toBe(0)
    const centre = ((H >> 1) * W + (W >> 1)) * 4
    expect(data[centre + 3]).toBe(255)
  })

  it('polygon draws the object over a transparent background', () => {
    const data = render(PolygonGenerator({ mesh: 'cube', rotationX: 0, rotationY: 0, rotationZ: 0 }))
    expect(data[3]).toBe(0)
    expect(data[((H >> 1) * W + (W >> 1)) * 4 + 3]).toBe(255)
  })

  it('built-in meshes wind their triangles outward', () => {
    for (const name of ['cube', 'octahedron', 'icosahedron', 'sphere', 'glenz'] satisfies MeshName[]) {
      const { verts, tris } = builtinMesh(name)
      for (const [a, b, c] of tris) {
        const n = cross(sub(verts[b]!, verts[a]!), sub(verts[c]!, verts[a]!))
        expect(dot(n, verts[a]!)).toBeGreaterThan(0)
      }
    }
  })
})

describe('new modifiers', () => {
  it('wobble with no amplitude leaves the input as it is', () => {
    const input = testInput()
    expect(apply(WobbleModifier({ amplitude: 0 }), input)).toEqual(input.data)
    expect(apply(WobbleModifier({ amplitude: 10 }), input)).not.toEqual(input.data)
  })

  it('dither only uses palette colours', () => {
    const out = apply(DitherModifier({ palette: 'gameboy' }), testInput())
    const allowed = new Set(['15,56,15', '48,98,48', '139,172,15', '155,188,15'])
    for (let i = 0; i < out.length; i += 4) expect(allowed.has(`${out[i]},${out[i + 1]},${out[i + 2]}`)).toBe(true)
  })

  it('bayer matrices hold every threshold once', () => {
    for (const n of [2, 4, 8]) {
      const m = Array.from(bayerMatrix(n), v => Math.round(v * n * n - 0.5)).sort((a, b) => a - b)
      expect(m).toEqual(Array.from({ length: n * n }, (_, i) => i))
    }
  })

  it('uv-map sphere is transparent outside the ball', () => {
    const out = apply(UvMapModifier({ preset: 'sphere', radius: 0.3 }), testInput())
    expect(out[3]).toBe(0)
    expect(out[((H >> 1) * W + (W >> 1)) * 4 + 3]).toBe(255)
    for (const preset of ['tunnel', 'flower', 'twirl'] as const) expect(lit(apply(UvMapModifier({ preset }), testInput()))).toBeGreaterThan(0.2)
  })

  it('bump lights a slope facing the light more than the same slope facing away', () => {
    // The square's left edge (x = 31) rises to the right; light it from 12 px left, then 12 px right.
    const edge = (lightX: number): number => apply(BumpModifier({ lightX, lightY: 27.5 / H, soften: 0 }), testInput())[(27 * W + 31) * 4]!
    expect(edge(19 / W)).toBeGreaterThan(edge(43 / W))
  })

  it('radial blur keeps the centre sharp and smears towards it', () => {
    const input = testInput()
    const out = apply(RadialBlurModifier({ strength: 0.5 }), input)
    const centre = ((H >> 1) * W + (W >> 1)) * 4
    expect(out[centre]).toBe(input.data[centre])
    expect(out).not.toEqual(input.data)
    const rays = apply(RadialBlurModifier({ mode: 'rays', threshold: 0.5 }), input)
    // Rays only add light.
    for (let i = 0; i < rays.length; i += 4) expect(rays[i]!).toBeGreaterThanOrEqual(input.data[i]!)
  })
})

describe('new transition modes on the compositor', () => {
  for (const mode of ['blinds', 'checker', 'push', 'melt'] as const) {
    it(`${mode} goes from base at 0 to overlay at 1`, () => {
      const base = buffer()
      base.data.fill(10)
      const overlay = buffer()
      overlay.data.fill(200)
      for (const [progress, expected] of [[0, 10], [1, 200]] as const) {
        const out = buffer()
        TransitionCompositor({ mode, progress, easing: 'linear' }).compose(ctx, { base, overlay }, out, signal(0))
        expect(new Set(Array.from(out.data.filter((_, i) => i % 4 === 0)))).toEqual(new Set([expected]))
      }
    })
  }
})
