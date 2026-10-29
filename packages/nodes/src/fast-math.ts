/**
 * Table-based sine for hot CPU pixel loops: 4096 entries with linear interpolation.
 * Max absolute error ≈ 3e-7 (well below one 8-bit color step); valid for |x| < ~3e6.
 */
const SIN_TABLE_SIZE = 4096
const SIN_MASK = SIN_TABLE_SIZE - 1
const SIN_INV_STEP = SIN_TABLE_SIZE / (Math.PI * 2)
const SIN_TABLE = new Float64Array(SIN_TABLE_SIZE + 1)
for (let i = 0; i <= SIN_TABLE_SIZE; i++) SIN_TABLE[i] = Math.sin((i / SIN_TABLE_SIZE) * Math.PI * 2)

export function fastSin(x: number): number {
  const f = x * SIN_INV_STEP
  const i = Math.floor(f)
  const k = i & SIN_MASK
  const a = SIN_TABLE[k]!
  return a + (SIN_TABLE[k + 1]! - a) * (f - i)
}
