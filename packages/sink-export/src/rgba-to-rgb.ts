/** Drop alpha; planar top-left RGB for ffmpeg rawvideo rgb24. */
export function rgbaToRgbStrip(rgba: Uint8ClampedArray, width: number, height: number, out: Uint8Array): void {
  let o = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      out[o++] = rgba[i] ?? 0
      out[o++] = rgba[i + 1] ?? 0
      out[o++] = rgba[i + 2] ?? 0
    }
  }
}

export function rgbStripByteLength(width: number, height: number): number {
  return width * height * 3
}
