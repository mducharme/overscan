import { createRequire } from 'node:module'
import type { FrameBuffer } from '@overscan/types'

const require = createRequire(import.meta.url)

type Image2Sixel = (
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  maxColors?: number,
  backgroundSelect?: 0 | 1 | 2,
) => string

const image2sixel = (require('sixel') as { image2sixel: Image2Sixel }).image2sixel

/** True sixel stream (quantized palette + band encoding) via jerch/sixel. */
export function renderSixel(frame: FrameBuffer): string {
  return image2sixel(frame.data, frame.width, frame.height, 256, 0)
}
