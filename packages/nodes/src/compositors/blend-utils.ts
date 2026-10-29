import type { CompositorEdgeTransform, CompositorInputMeta, FrameBuffer } from '@overscan/types'
import { samplePixel } from '@overscan/core/browser'

export function luma(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

export function hasTransforms(inputMeta?: Readonly<Record<string, CompositorInputMeta>>): boolean {
  return Object.values(inputMeta ?? {}).some(meta => meta?.transform !== undefined)
}

export function sampleInputs(
  base: FrameBuffer,
  overlay: FrameBuffer,
  maskBuf: FrameBuffer | undefined,
  width: number,
  height: number,
  x: number,
  y: number,
  inputMeta?: Readonly<Record<string, CompositorInputMeta>>,
): {
  br: number; bg: number; bb: number; ba: number;
  or: number; og: number; ob: number; oa: number;
  mask: number;
} {
  const metaBase = inputMeta ?? {}
  const [br, bg, bb, ba] = samplePixel(base, width, height, x, y, metaBase['base']?.transform)
  const [or, og, ob, oa] = samplePixel(overlay, width, height, x, y, metaBase['overlay']?.transform)
  let mask = 1
  if (maskBuf) {
    const [mr, mg, mb] = samplePixel(maskBuf, width, height, x, y, metaBase['mask']?.transform)
    mask = luma(mr, mg, mb)
  }
  return { br, bg, bb, ba, or, og, ob, oa, mask }
}

export interface BlendSample {
  br: number; bg: number; bb: number; ba: number
  or: number; og: number; ob: number; oa: number
  mask: number
}

export interface InputSampler {
  /** Samples all inputs at output pixel (x, y). Returns a shared object — read it before the next call. */
  sample(x: number, y: number): BlendSample
}

/** Fills `out` (outW × RGBA floats) with one output row sampled from the input. */
type RowSampler = (y: number, out: Float64Array) => void

/** Pixel-center source coordinate for output index `i`, clamped to the texture edge (GPU LINEAR + CLAMP_TO_EDGE). */
function sourceCoord(i: number, srcSize: number, outSize: number): number {
  return Math.min(srcSize - 1, Math.max(0, (i + 0.5) * (srcSize / outSize) - 0.5))
}

/**
 * Per-input bilinear row sampler for inputs whose size differs from the output (or that carry an edge
 * transform). Untransformed inputs use pixel-center mapping like the GPU path; transformed inputs use `samplePixel`.
 */
function createRowSampler(
  buf: FrameBuffer,
  outW: number,
  outH: number,
  transform: CompositorEdgeTransform | undefined,
): RowSampler {
  if (transform) {
    return (y, out) => {
      for (let x = 0; x < outW; x++) {
        const px = samplePixel(buf, outW, outH, x, y, transform)
        const at = x * 4
        out[at] = px[0]; out[at + 1] = px[1]; out[at + 2] = px[2]; out[at + 3] = px[3]
      }
    }
  }
  const { width: w, height: h, data } = buf
  const col0 = new Int32Array(outW)
  const col1 = new Int32Array(outW)
  const colT = new Float64Array(outW)
  for (let x = 0; x < outW; x++) {
    const sx = sourceCoord(x, w, outW)
    const x0 = Math.floor(sx)
    col0[x] = x0 * 4
    col1[x] = Math.min(x0 + 1, w - 1) * 4
    colT[x] = sx - x0
  }
  return (y, out) => {
    const sy = sourceCoord(y, h, outH)
    const y0 = Math.floor(sy)
    const ty = sy - y0
    const r0 = y0 * w * 4
    const r1 = Math.min(y0 + 1, h - 1) * w * 4
    for (let x = 0; x < outW; x++) {
      const tx = colT[x]!
      const w00 = (1 - tx) * (1 - ty)
      const w01 = tx * (1 - ty)
      const w10 = (1 - tx) * ty
      const w11 = tx * ty
      const o00 = r0 + col0[x]!
      const o01 = r0 + col1[x]!
      const o10 = r1 + col0[x]!
      const o11 = r1 + col1[x]!
      const at = x * 4
      out[at] = data[o00]! * w00 + data[o01]! * w01 + data[o10]! * w10 + data[o11]! * w11
      out[at + 1] = data[o00 + 1]! * w00 + data[o01 + 1]! * w01 + data[o10 + 1]! * w10 + data[o11 + 1]! * w11
      out[at + 2] = data[o00 + 2]! * w00 + data[o01 + 2]! * w01 + data[o10 + 2]! * w10 + data[o11 + 2]! * w11
      out[at + 3] = data[o00 + 3]! * w00 + data[o01 + 3]! * w01 + data[o10 + 3]! * w10 + data[o11 + 3]! * w11
    }
  }
}

/**
 * Row source for one input: same-size untransformed inputs are read in place (1:1 pixels, like the GPU);
 * anything else is resampled into a scratch row on first access.
 */
interface InputRows {
  data: ArrayLike<number>
  offset: number
  load(y: number): void
}

function createInputRows(
  buf: FrameBuffer,
  outW: number,
  outH: number,
  transform: CompositorEdgeTransform | undefined,
): InputRows {
  if (!transform && buf.width === outW && buf.height === outH) {
    const rows: InputRows = {
      data: buf.data,
      offset: 0,
      load(y) { rows.offset = y * outW * 4 },
    }
    return rows
  }
  const sampleRow = createRowSampler(buf, outW, outH, transform)
  const row = new Float64Array(outW * 4)
  return { data: row, offset: 0, load(y) { sampleRow(y, row) } }
}

/**
 * Build once per compose(); replaces per-pixel `sampleInputs` without per-pixel allocation.
 * Rows are fetched on first access, so iterate x within y (row-major) for best speed.
 */
export function createInputSampler(
  base: FrameBuffer,
  overlay: FrameBuffer,
  maskBuf: FrameBuffer | undefined,
  width: number,
  height: number,
  inputMeta?: Readonly<Record<string, CompositorInputMeta>>,
): InputSampler {
  const baseRows = createInputRows(base, width, height, inputMeta?.['base']?.transform)
  const overlayRows = createInputRows(overlay, width, height, inputMeta?.['overlay']?.transform)
  const maskRows = maskBuf ? createInputRows(maskBuf, width, height, inputMeta?.['mask']?.transform) : null
  let rowY = -1
  const result: BlendSample = { br: 0, bg: 0, bb: 0, ba: 0, or: 0, og: 0, ob: 0, oa: 0, mask: 1 }
  return {
    sample(x, y) {
      if (y !== rowY) {
        rowY = y
        baseRows.load(y)
        overlayRows.load(y)
        maskRows?.load(y)
      }
      const b = baseRows.data
      const bi = baseRows.offset + x * 4
      const o = overlayRows.data
      const oi = overlayRows.offset + x * 4
      result.br = b[bi]!; result.bg = b[bi + 1]!; result.bb = b[bi + 2]!; result.ba = b[bi + 3]!
      result.or = o[oi]!; result.og = o[oi + 1]!; result.ob = o[oi + 2]!; result.oa = o[oi + 3]!
      if (maskRows) {
        const m = maskRows.data
        const mi = maskRows.offset + x * 4
        result.mask = luma(m[mi]!, m[mi + 1]!, m[mi + 2]!)
      }
      return result
    },
  }
}
