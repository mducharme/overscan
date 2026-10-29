/**
 * Reference viewport for interpreting numeric defaults (matches typical scene JSON 640×360).
 * Generators scale thickness, periods, and projection so terminal-sized buffers match HD previews.
 */
export const VIEWPORT_REF_WIDTH = 640
export const VIEWPORT_REF_HEIGHT = 360
export const VIEWPORT_REF_MIN = Math.min(VIEWPORT_REF_WIDTH, VIEWPORT_REF_HEIGHT)

export function viewportMinDim(w: number, h: number): number {
  return Math.max(1, Math.min(w, h))
}

/** Line width, point radius, etc. tuned at the reference viewport. */
export function scaleThickness(refPx: number, w: number, h: number): number {
  return (refPx * viewportMinDim(w, h)) / VIEWPORT_REF_MIN
}

/** Vertical period in pixels (e.g. copper bar height) at reference height. */
export function scaleVerticalPeriod(refPx: number, frameHeight: number): number {
  return Math.max(1e-6, (refPx * frameHeight) / VIEWPORT_REF_HEIGHT)
}

/** Perspective scale factor from configs tuned at VIEWPORT_REF_MIN. */
export function scaleFovMultiplier(fov: number, w: number, h: number): number {
  return (fov * viewportMinDim(w, h)) / VIEWPORT_REF_MIN
}

/** Bitmap font “point size” at reference min dimension → effective size for this frame. */
export function scaleFontSize(refFontSize: number, w: number, h: number): number {
  return (refFontSize * viewportMinDim(w, h)) / VIEWPORT_REF_MIN
}

/**
 * Per-axis factors that make normalized coordinates square: the short side keeps its range and the
 * long side extends, so circles stay round and rotations stay rigid at any aspect ratio.
 * Multiply centered coordinates (or differences of normalized coordinates) by these.
 */
export function aspectScale(w: number, h: number): { x: number; y: number } {
  const min = viewportMinDim(w, h)
  return { x: Math.max(1, w) / min, y: Math.max(1, h) / min }
}

/** GLSL twin of `aspectScale`; interpolate into a fragment shader that has `u_resolution`. */
export const ASPECT_SCALE_GLSL = 'vec2 aspectScale(vec2 res) { return res / min(res.x, res.y); }'
