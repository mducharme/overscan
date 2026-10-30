import type { LoadedImageAsset } from '@overscan/types'

/** Decodes PNG/JPEG/… bytes in the browser into RGBA pixels for the asset manager. */
export async function decodeImageInBrowser(bytes: Uint8Array): Promise<LoadedImageAsset | undefined> {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]))
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d')
    if (!context) return undefined
    context.drawImage(bitmap, 0, 0)
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height)
    return { width: bitmap.width, height: bitmap.height, data }
  } finally {
    bitmap.close()
  }
}
