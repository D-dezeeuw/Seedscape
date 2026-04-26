// World generation pipeline v2. Lives alongside the v1 module
// (`generation.ts`) so both can be exercised during the rollout, and
// because the v1 fixtures double as a regression baseline.
//
// Differences from v1:
//   • Multi-octave fBm for terrain (5 octaves) and moisture (3 octaves).
//     The previous single-sample noise gave readable but circular blobs;
//     fBm adds the small-scale detail that sells "real terrain".
//   • Domain warp on the input coords, decorrelated from terrain and
//     moisture by using two extra seeded noise instances. Breaks the
//     symmetric swirly-blob look simplex tends to produce.
//   • 8 distinct tile outputs (deep water → mountain) via the rewritten
//     bloomridgeTile mapping in src/world/biomes/bloomridge.ts.
//
// The pipeline is still pure: same (worldSeed, chunkX, chunkY) → same
// output bytes. Workers can run it in parallel without contention.

import { createNoise2D, domainWarp, fbm2, type Noise2D } from "../shared/noise";
import { bloomridgeTile, MOISTURE_BANDS, quantizeNoise, TERRAIN_BANDS } from "./biomes/bloomridge";
import { allocChunkData, CHUNK_SIZE, type ChunkData, tileIndex } from "./chunk";

// Tile-space scales. Terrain features are larger than moisture features
// — feels right because elevation tends to vary on a coarser grid than
// "is this patch wet?".
const TERRAIN_SCALE = 96;
const MOISTURE_SCALE = 64;
const WARP_SCALE = 128;

// Octave counts. 5 for terrain (multiscale ridges + fine roughness),
// 3 for moisture (avoids a noisy climate map).
const TERRAIN_OCTAVES = 5;
const MOISTURE_OCTAVES = 3;

// Warp strength in *tile-space units before scaling*. Tuned by eye to
// give organic shorelines without obliterating the recognizable shapes.
const WARP_STRENGTH = 24;

// Four uncorrelated seeds derived from worldSeed. Bit patterns are
// arbitrary primes — what matters is that they're stable across runs.
const TERRAIN_OFFSET = 0;
const MOISTURE_OFFSET = 0x9e3779b9;
const WARP_X_OFFSET = 0x6a09e667;
const WARP_Y_OFFSET = 0xbb67ae85;

export interface WorldNoiseV2 {
  terrain: Noise2D;
  moisture: Noise2D;
  warpX: Noise2D;
  warpY: Noise2D;
}

export function createWorldNoiseV2(worldSeed: number): WorldNoiseV2 {
  return {
    terrain: createNoise2D((worldSeed ^ TERRAIN_OFFSET) >>> 0),
    moisture: createNoise2D((worldSeed ^ MOISTURE_OFFSET) >>> 0),
    warpX: createNoise2D((worldSeed ^ WARP_X_OFFSET) >>> 0),
    warpY: createNoise2D((worldSeed ^ WARP_Y_OFFSET) >>> 0),
  };
}

// Sample the height field at a single world-tile coordinate. Exported so
// the future slope/cliff pass can call it for neighbor heights without
// reconstructing the pipeline.
export function sampleHeight(noise: WorldNoiseV2, worldX: number, worldY: number): number {
  // Warp coords first so the warped point feeds the fBm. Both samples
  // happen in tile-space (divided by WARP_SCALE), so the perturbation
  // amplitude lines up with the height field's feature size.
  const warped = domainWarp(
    worldX / WARP_SCALE,
    worldY / WARP_SCALE,
    noise.warpX,
    noise.warpY,
    WARP_STRENGTH / WARP_SCALE,
  );
  return fbm2(noise.terrain, warped.x * (WARP_SCALE / TERRAIN_SCALE), warped.y * (WARP_SCALE / TERRAIN_SCALE), TERRAIN_OCTAVES);
}

export function sampleMoisture(noise: WorldNoiseV2, worldX: number, worldY: number): number {
  return fbm2(noise.moisture, worldX / MOISTURE_SCALE, worldY / MOISTURE_SCALE, MOISTURE_OCTAVES);
}

// Generate one chunk under v2. Caller may pass a preallocated ChunkData
// to avoid allocation in steady state (workers reuse buffers across
// tasks).
export function generateChunkV2(
  noise: WorldNoiseV2,
  chunkX: number,
  chunkY: number,
  out?: ChunkData,
): ChunkData {
  const chunk = out ?? allocChunkData();
  const baseX = chunkX * CHUNK_SIZE;
  const baseY = chunkY * CHUNK_SIZE;

  for (let y = 0; y < CHUNK_SIZE; y++) {
    const worldY = baseY + y;
    for (let x = 0; x < CHUNK_SIZE; x++) {
      const worldX = baseX + x;
      const h = sampleHeight(noise, worldX, worldY);
      const m = sampleMoisture(noise, worldX, worldY);
      const terrainBand = quantizeNoise(h, TERRAIN_BANDS);
      const moistureBand = quantizeNoise(m, MOISTURE_BANDS);
      const idx = tileIndex(x, y);
      chunk.tileId[idx] = bloomridgeTile(terrainBand, moistureBand);
      chunk.state[idx] = 0;
      chunk.metadata[idx] = 0;
    }
  }

  return chunk;
}
