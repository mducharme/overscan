import type { CompositorEdgeTransform, FrameBuffer } from '@overscan/types'

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

function bilinear(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  fx: number,
  fy: number,
): [number, number, number, number] {
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const x1 = Math.min(x0 + 1, w - 1)
  const y1 = Math.min(y0 + 1, h - 1)
  const tx = fx - x0
  const ty = fy - y0
  const idx = (yy: number, xx: number) => (yy * w + xx) * 4
  let r = 0
  let g = 0
  let b = 0
  let a = 0
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 2; i++) {
      const wx = i === 0 ? 1 - tx : tx
      const wy = j === 0 ? 1 - ty : ty
      const xx = i === 0 ? x0 : x1
      const yy = j === 0 ? y0 : y1
      const o = idx(yy, xx)
      const ww = wx * wy
      r += (data[o] ?? 0) * ww
      g += (data[o + 1] ?? 0) * ww
      b += (data[o + 2] ?? 0) * ww
      a += (data[o + 3] ?? 0) * ww
    }
  }
  return [r, g, b, a]
}

/**
 * Map output pixel (ox,oy) to source buffer (sx,sy) using rect + optional rotation.
 * Rect: top-left (px*W, py*H), size (sxN*W, syN*H) in output pixels.
 */
function outputToSourceUV(
  ox: number,
  oy: number,
  W: number,
  H: number,
  tr: CompositorEdgeTransform,
): { sx: number; sy: number; inside: boolean } {
  const [px, py] = tr.position
  const [sxN, syN] = tr.scale
  const x0 = px * W
  const y0 = py * H
  const rw = Math.max(1e-6, sxN * W)
  const rh = Math.max(1e-6, syN * H)
  const cx = x0 + rw / 2
  const cy = y0 + rh / 2
  let lx = ox - cx
  let ly = oy - cy
  const rot = tr.rotation ?? 0
  if (rot !== 0) {
    const c = Math.cos(-rot)
    const s = Math.sin(-rot)
    const nx = lx * c - ly * s
    const ny = lx * s + ly * c
    lx = nx
    ly = ny
  }
  const u = lx / rw + 0.5
  const v = ly / rh + 0.5
  const inside = u >= 0 && u <= 1 && v >= 0 && v <= 1
  return { sx: u, sy: v, inside }
}

/** Sample frame as if it covers full output; optional transform maps placement to a sub-rect. */
export function samplePixel(
  buf: FrameBuffer,
  outW: number,
  outH: number,
  ox: number,
  oy: number,
  transform: CompositorEdgeTransform | undefined,
): [number, number, number, number] {
  const { width: w, height: h, data } = buf
  if (!transform) {
    const sx = (ox / outW) * (w - 1)
    const sy = (oy / outH) * (h - 1)
    return bilinear(data, w, h, sx, sy)
  }
  const uv = outputToSourceUV(ox, oy, outW, outH, transform)
  if (!uv.inside) return [0, 0, 0, 0]
  const sx = clamp01(uv.sx) * (w - 1)
  const sy = clamp01(uv.sy) * (h - 1)
  return bilinear(data, w, h, sx, sy)
}
