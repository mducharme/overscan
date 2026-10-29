/**
 * Deterministic randomness for nodes, so renders and exports are reproducible.
 * Nodes take an optional `randomSeed` config (default 1); vary it to decorrelate two otherwise identical nodes.
 */

export const DEFAULT_RANDOM_SEED = 1

/** Seeded stream (mulberry32) for effects that draw values sequentially; recreate it in `init()`. */
export function createRng(seed: number = DEFAULT_RANDOM_SEED): () => number {
  let a = Math.floor(seed) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Stateless value in [0, 1) for integer coordinates, e.g. (seed, cycle): same inputs, same value, even after a seek. */
export function hash01(...values: number[]): number {
  let h = 2166136261
  for (const v of values) {
    h ^= Math.floor(v) >>> 0
    h = Math.imul(h, 16777619)
    h ^= h >>> 13
    h = Math.imul(h, 0x5bd1e995)
    h ^= h >>> 15
  }
  return (h >>> 0) / 4294967296
}
