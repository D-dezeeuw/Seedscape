// Pure chunk generation pipeline. Same input → same output bytes; safe to run
// in any thread. Per docs/07_world_generation.md.

import { createNoise2D, type Noise2D } from "../shared/noise";
import { bloomridgeTile, MOISTURE_BANDS, quantizeNoise, TERRAIN_BANDS } from "./biomes/bloomridge";
import { allocChunkData, CHUNK_SIZE, type ChunkData, tileIndex } from "./chunk";

// Tile-space noise scales per docs/07_world_generation.md.
const TERRAIN_SCALE = 96;
const MOISTURE_SCALE = 64;
// Two seed offsets so terrain and moisture share worldSeed but produce
// uncorrelated fields. Bit patterns are arbitrary primes.
const TERRAIN_SEED_OFFSET = 0;
const MOISTURE_SEED_OFFSET = 0x9e3779b9;

export interface WorldNoise {
  terrain: Noise2D;
  moisture: Noise2D;
}

export function createWorldNoise(worldSeed: number): WorldNoise {
  return {
    terrain: createNoise2D((worldSeed ^ TERRAIN_SEED_OFFSET) >>> 0),
    moisture: createNoise2D((worldSeed ^ MOISTURE_SEED_OFFSET) >>> 0),
  };
}

// Generate one chunk. Caller may pass a preallocated ChunkData to avoid the
// allocation in steady state (workers reuse buffers across tasks).
export function generateChunk(
  noise: WorldNoise,
  chunkX: number,
  chunkY: number,
  out?: ChunkData,
): ChunkData {
  const chunk = out ?? allocChunkData();
  const { terrain, moisture } = noise;
  const baseX = chunkX * CHUNK_SIZE;
  const baseY = chunkY * CHUNK_SIZE;

  for (let y = 0; y < CHUNK_SIZE; y++) {
    const worldY = baseY + y;
    for (let x = 0; x < CHUNK_SIZE; x++) {
      const worldX = baseX + x;
      const t = terrain(worldX / TERRAIN_SCALE, worldY / TERRAIN_SCALE);
      const m = moisture(worldX / MOISTURE_SCALE, worldY / MOISTURE_SCALE);
      const terrainBand = quantizeNoise(t, TERRAIN_BANDS);
      const moistureBand = quantizeNoise(m, MOISTURE_BANDS);
      const idx = tileIndex(x, y);
      chunk.tileId[idx] = bloomridgeTile(terrainBand, moistureBand);
      chunk.state[idx] = 0;
      chunk.metadata[idx] = 0;
    }
  }

  return chunk;
}
