// Auto-water tick. Runs on the main thread once per sim tick, after
// the per-chunk sim worker dispatches. Walks every loaded chunk; for
// each Well or Sprinkler tile, raises the water level on every
// tilled-farmland or crop tile within the building's radius.
//
// Cross-chunk reach is handled by going through the ChunkManager —
// neighbour-tile lookups peek the appropriate chunk by world coords.
// Tiles in unloaded chunks are silently skipped (the sim won't decay
// their water either, so they stay in their last persisted state).
//
// Recharge cadence is per-building: a Well refills at WELL_PERIOD
// ticks, a Sprinkler at SPRINKLER_PERIOD. On a "wet" tick the radius
// is clamped to WATER_MAX; on dry ticks the irrigation is silent.

import { CHUNK_SIZE, CHUNK_FLAG_DIRTY_RENDER, CHUNK_FLAG_DIRTY_SIMULATION, tileIndex } from "../chunk";
import type { ChunkManager } from "../chunk_manager";
import { cropForTile } from "./crop_registry";
import { getWaterLevel, setWaterLevel } from "./tile_actions";

// Building tile ids (must match building_registry.ts). Hardcoded here
// to avoid pulling the full registry into a hot loop.
const TILE_WELL = 230;
const TILE_SPRINKLER = 231;
const TILE_FARMLAND_TILLED = 13;
const WATER_MAX = 3;

// Recharge periods. Sprinklers fire twice as often as wells so the
// upgrade actually feels stronger than just "more area."
const WELL_PERIOD = 10;
const SPRINKLER_PERIOD = 5;

// Half-extent in tiles. radius=1 → 3×3, radius=2 → 5×5.
const WELL_RADIUS = 1;
const SPRINKLER_RADIUS = 2;

export function irrigationTick(chunkManager: ChunkManager, simTick: number): void {
  if (simTick <= 0) return;
  const wellsActive = simTick % WELL_PERIOD === 0;
  const sprinklersActive = simTick % SPRINKLER_PERIOD === 0;
  if (!wellsActive && !sprinklersActive) return;

  for (const [key, record] of chunkManager.allChunkRecords()) {
    const data = record.data;
    const [cxStr, cyStr] = key.split(",");
    const baseX = Number(cxStr) * CHUNK_SIZE;
    const baseY = Number(cyStr) * CHUNK_SIZE;

    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const tileId = data.tileId[tileIndex(lx, ly)] ?? 0;
        if (tileId === TILE_WELL && wellsActive) {
          waterRadius(chunkManager, baseX + lx, baseY + ly, WELL_RADIUS);
        } else if (tileId === TILE_SPRINKLER && sprinklersActive) {
          waterRadius(chunkManager, baseX + lx, baseY + ly, SPRINKLER_RADIUS);
        }
      }
    }
  }
}

// Raise water on every tilled-farmland or crop tile within the radius
// (Chebyshev / square footprint). Marks each affected chunk dirty so
// the GPU re-uploads and the sim picks up the new water level next
// tick. The source tile itself is skipped — wells don't water themselves.
function waterRadius(
  chunkManager: ChunkManager,
  centerX: number,
  centerY: number,
  radius: number,
): void {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx === 0 && dy === 0) continue;
      const wx = centerX + dx;
      const wy = centerY + dy;
      const cx = Math.floor(wx / CHUNK_SIZE);
      const cy = Math.floor(wy / CHUNK_SIZE);
      const record = chunkManager.peekChunk(cx, cy);
      if (!record) continue;
      const llx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
      const lly = ((wy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
      const i = tileIndex(llx, lly);
      const tileId = record.data.tileId[i] ?? 0;
      // Only farmable tiles benefit — tilled farmland (state stores
      // dryness via metadata) and live crops.
      const isFarmable = tileId === TILE_FARMLAND_TILLED || cropForTile(tileId) !== null;
      if (!isFarmable) continue;
      const meta = record.data.metadata[i] ?? 0;
      const water = getWaterLevel(meta);
      if (water >= WATER_MAX) continue;
      record.data.metadata[i] = setWaterLevel(meta, WATER_MAX);
      record.flags |= CHUNK_FLAG_DIRTY_RENDER | CHUNK_FLAG_DIRTY_SIMULATION;
    }
  }
}
