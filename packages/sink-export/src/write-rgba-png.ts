import { writeFile } from 'node:fs/promises'
import { createCanvas } from 'canvas'

/** RGBA8 buffer in top-left raster order (row-major). */
export async function writeRgbaPng(
  path: string,
  width: number,
  height: number,
  rgba: Uint8ClampedArray | Uint8Array,
): Promise<void> {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  const img = ctx.createImageData(width, height)
  img.data.set(rgba)
  ctx.putImageData(img, 0, 0)
  await writeFile(path, canvas.toBuffer('image/png'))
}
