// Deterministic 32-bit RNG. Workers and any sim-side code MUST use this — never
// Math.random(). State is a single Uint32 carried by the caller.

// Mulberry32: small, fast, passes basic statistical tests at this size.
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 32-bit mix used to derive a chunk seed from (worldSeed, chunkX, chunkY).
// Triple-prime XOR gives well-spread chunk seeds without collision in any
// reasonable world span, while staying purely arithmetic and deterministic.
export function hashChunkSeed(worldSeed: number, chunkX: number, chunkY: number): number {
  let h = (worldSeed | 0) >>> 0;
  h = Math.imul(h ^ ((chunkX | 0) >>> 0), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ ((chunkY | 0) >>> 0), 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
}
