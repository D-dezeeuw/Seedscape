// Bloomridge tile assignment. Maps (terrainBand, moistureBand) → tileId per
// the spec table in docs/08_biomes.md. Terrain bands are 0..7; moisture bands
// are 0..3. The rules are pure data; the noise → band conversion lives in the
// generation pipeline so this table can be reused by other tooling.

// Tile IDs taken from data/tiles.json (ground range 0..99). Keeping these
// inline rather than importing from JSON because they're load-bearing for
// generation; if data/tiles.json drifts, generation regression tests fail.
export const BLOOMRIDGE_TILES = {
  shallowWater: 0,
  dryGrass: 10,
  richSoil: 11,
  farmlandUntilled: 12,
  rockyOutcrop: 20,
} as const;

export const TERRAIN_BANDS = 8; // 0..7
export const MOISTURE_BANDS = 4; // 0..3

// Convert [-1, 1] noise → integer band [0, bands-1]. Uses (n + 1) / 2 to map
// the noise range to [0, 1], then floors into bands; the final clamp catches
// the extreme edge case where noise === 1 exactly.
export function quantizeNoise(value: number, bands: number): number {
  const t = Math.max(0, Math.min(1, (value + 1) / 2));
  return Math.min(bands - 1, Math.floor(t * bands));
}

export function bloomridgeTile(terrainBand: number, moistureBand: number): number {
  if (terrainBand <= 0) return BLOOMRIDGE_TILES.shallowWater;
  if (terrainBand <= 2) {
    return moistureBand >= 2 ? BLOOMRIDGE_TILES.richSoil : BLOOMRIDGE_TILES.dryGrass;
  }
  if (terrainBand <= 5) return BLOOMRIDGE_TILES.farmlandUntilled;
  return BLOOMRIDGE_TILES.rockyOutcrop;
}
