// Pure simulation tick for one chunk. Returns delta of changed tiles per the
// worker-architecture contract (docs/14): {indices, tileId, state, metadata}
// arrays of length `count`. Same input → same output bytes (deterministic).
//
// Phase 3 model: stages advance every `growthInterval` ticks (= round(1 /
// baseRate)) when water > 0; water decays every WATER_DECAY_INTERVAL ticks.
// Wilt is documented in docs/09 with a per-tile counter — deferred to a
// later phase since metadata bits 5-7 are reserved for the seed-variant
// system. See memory/project_phase3_deferred.md.

import { type ChunkData, TILES_PER_CHUNK } from "../chunk";
import { CROP_STAGE_HARVESTABLE, CROP_STATE_WILTED, cropForTile } from "./crop_registry";
import { getWaterLevel, setWaterLevel } from "./tile_actions";

// Decay water by 1 level every N ticks. Tied to tick-rate constants in main:
// at 1 TPS that's 4-second decay per level → 12 seconds from saturated to dry.
export const WATER_DECAY_INTERVAL = 4;

export interface SimDelta {
  count: number;
  indices: Uint16Array;
  tileId: Uint16Array;
  state: Uint8Array;
  metadata: Uint8Array;
}

// Pre-allocated scratch arrays sized for the worst case (every tile changes).
// The worker reuses one set across ticks; we allocate fresh ones for the
// payload we transfer back, since the buffers transfer to the main thread.
export interface SimScratch {
  indices: Uint16Array;
  tileId: Uint16Array;
  state: Uint8Array;
  metadata: Uint8Array;
}

export function allocSimScratch(): SimScratch {
  return {
    indices: new Uint16Array(TILES_PER_CHUNK),
    tileId: new Uint16Array(TILES_PER_CHUNK),
    state: new Uint8Array(TILES_PER_CHUNK),
    metadata: new Uint8Array(TILES_PER_CHUNK),
  };
}

function growthInterval(baseRate: number): number {
  // round(1 / baseRate) clamped ≥ 1 — ensures slower crops still tick eventually.
  if (baseRate <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(1, Math.round(1 / baseRate));
}

export function simulateChunkTick(chunk: ChunkData, tick: number, scratch: SimScratch): SimDelta {
  let count = 0;
  for (let i = 0; i < TILES_PER_CHUNK; i++) {
    const tileId = chunk.tileId[i] ?? 0;
    const crop = cropForTile(tileId);
    if (!crop) continue;

    const state = chunk.state[i] ?? 0;
    if (state === CROP_STATE_WILTED) continue;

    const meta = chunk.metadata[i] ?? 0;
    const water = getWaterLevel(meta);

    let nextState = state;
    let nextMeta = meta;
    let changed = false;

    // Growth: advance stage when watered and the tick lines up with the
    // crop's interval. tick=0 doesn't count to avoid an instant first-tick
    // jump for newly planted tiles.
    if (state < CROP_STAGE_HARVESTABLE && water > 0 && tick > 0) {
      if (tick % growthInterval(crop.baseRate) === 0) {
        nextState = state + 1;
        changed = true;
      }
    }

    // Water decay every WATER_DECAY_INTERVAL ticks.
    if (water > 0 && tick > 0 && tick % WATER_DECAY_INTERVAL === 0) {
      nextMeta = setWaterLevel(meta, water - 1);
      if (nextMeta !== meta) changed = true;
    }

    if (!changed) continue;

    scratch.indices[count] = i;
    scratch.tileId[count] = tileId;
    scratch.state[count] = nextState;
    scratch.metadata[count] = nextMeta;
    count++;
  }

  return {
    count,
    indices: scratch.indices,
    tileId: scratch.tileId,
    state: scratch.state,
    metadata: scratch.metadata,
  };
}

export function applySimDelta(chunk: ChunkData, delta: SimDelta): void {
  for (let n = 0; n < delta.count; n++) {
    const idx = delta.indices[n] as number;
    chunk.tileId[idx] = delta.tileId[n] as number;
    chunk.state[idx] = delta.state[n] as number;
    chunk.metadata[idx] = delta.metadata[n] as number;
  }
}
