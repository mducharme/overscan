import type { CompositorInputMeta, FrameBuffer } from '@overscan/types'
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
