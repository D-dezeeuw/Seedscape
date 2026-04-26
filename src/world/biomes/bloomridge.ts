// Bloomridge tile assignment. Maps (terrainBand, moistureBand) → tileId per
// the spec table in docs/08_biomes.md. Terrain bands are 0..7; moisture bands
// are 0..3. The rules are pure data; the noise → band conversion lives in the
// generation pipeline so this table can be reused by other tooling.

// Tile IDs taken from data/tiles.json (ground range 0..99). Keeping these
// inline rather than importing from JSON because they're load-bearing for
// generation; if data/tiles.json drifts, generation regression tests fail.
export const BLOOMRIDGE_TILES = {
  deepWater: 1,
  shallowWater: 0,
  beachSand: 25,
  dryGrass: 10,
  richSoil: 11,
  farmlandUntilled: 12,
  barrenStone: 22,
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

// Bloomridge terrain bands — non-uniform thresholds against the [0, 1]
// normalized fBm output. The 5-octave fBm we use produces a much
// narrower distribution than the [0, 1] envelope suggests: at the live
// world seed roughly 99% of values fall in [0.20, 0.85]. Thresholds
// below are tuned against that empirical histogram so each band gets
// a meaningful slice of actual tiles, not just nominal range.
//
//   Threshold (cum)  Band                        ≈ % of tiles
//   < 0.27           0  deep water                   ~5%
//   < 0.32           1  shallow water                ~8%
//   < 0.36           2  beach                        ~5%
//   < 0.43           3  rich soil / dry grass       ~22%
//   < 0.55           4  farmland untilled           ~25%
//   < 0.62           5  dry grass                   ~14%
//   < 0.68           6  barren stone                ~10%
//   ≥ 0.68           7  rocky outcrop               ~10%
export const TERRAIN_THRESHOLDS: ReadonlyArray<number> = [0.27, 0.32, 0.36, 0.43, 0.55, 0.62, 0.68];

// Map a [-1, 1] noise value to a terrain band [0..7] via TERRAIN_THRESHOLDS.
// Returns the index of the first threshold the normalized value falls below;
// values at or above the last threshold land in the final band.
export function terrainBandFromHeight(value: number): number {
  const t = Math.max(0, Math.min(1, (value + 1) / 2));
  for (let i = 0; i < TERRAIN_THRESHOLDS.length; i++) {
    if (t < (TERRAIN_THRESHOLDS[i] as number)) return i;
  }
  return TERRAIN_THRESHOLDS.length;
}

// 8-band tile mapping per docs/08_biomes.md (worldgen v2). Each terrain
// band gets its own output tile so the elevation profile reads as deep
// water → shore → fertile band → highlands → mountain. Moisture switches
// between dry and rich variants in the middle bands where it matters most.
export function bloomridgeTile(terrainBand: number, moistureBand: number): number {
  switch (terrainBand) {
    case 0:
      return BLOOMRIDGE_TILES.deepWater;
    case 1:
      return BLOOMRIDGE_TILES.shallowWater;
    case 2:
      return BLOOMRIDGE_TILES.beachSand;
    case 3:
      // Lush band closest to water — moisture decides between rich soil
      // (the prime farmland substrate) and dry grass.
      return moistureBand >= 2 ? BLOOMRIDGE_TILES.richSoil : BLOOMRIDGE_TILES.dryGrass;
    case 4:
      // Mid-elevation: untilled farmland in moist regions, dry grass elsewhere.
      return moistureBand >= 1 ? BLOOMRIDGE_TILES.farmlandUntilled : BLOOMRIDGE_TILES.dryGrass;
    case 5:
      return BLOOMRIDGE_TILES.dryGrass;
    case 6:
      return BLOOMRIDGE_TILES.barrenStone;
    default:
      return BLOOMRIDGE_TILES.rockyOutcrop;
  }
}
