// Pure simulation tick for one chunk. Returns delta of changed tiles per the
// worker-architecture contract (docs/14): {indices, tileId, state, metadata}
// arrays of length `count`. Same input → same output bytes (deterministic).
//
// Phase 3 model: stages advance every `growthInterval` ticks (= round(1 /
// baseRate)) when water > 0; water decays every WATER_DECAY_INTERVAL ticks.
// Wilt is documented in docs/09 with a per-tile counter — deferred to a
// later phase since metadata bits 5-7 are reserved for the seed-variant
// system. See memory/project_phase_deferred.md.
//
// Phase 4 extension: building tiles also tick. Buildings consume queued jobs
// and produce output items — outputs can't be applied to player inventory
// here (the sim runs in a worker), so we emit ProductionEvents which the
// main thread translates into inventory adds.

import { type ChunkData, TILES_PER_CHUNK } from "../chunk";
import {
  BUILDING_STATE_IDLE,
  buildingForTile,
  getQueuedJobs,
  setQueuedJobs,
} from "./building_registry";
import { CROP_STAGE_HARVESTABLE, CROP_STATE_WILTED, cropForTile } from "./crop_registry";
import { getWaterLevel, setWaterLevel } from "./tile_actions";

export const WATER_DECAY_INTERVAL = 4;

export interface ProductionEvent {
  // Tile-local index inside the chunk so the main thread can attribute
  // the output (HUD, animations later).
  tileIndex: number;
  // Building tile id at sim time. Main thread compares this against the
  // live chunk before crediting — if the player dismantled or replaced
  // the building during sim flight the credit is dropped (race-loss
  // policy consistent with applySimDelta).
  expectedTileId: number;
  itemId: number;
  quantity: number;
}

// Per-tile delta. `prev*` arrays carry the values the sim observed when
// it computed the change — applySimDelta uses them as a guard so that
// player actions that landed during the worker's in-flight window
// (which mutated chunk.data while the sim was looking at a snapshot)
// don't get silently overwritten by the sim's stale update.
export interface SimDelta {
  count: number;
  indices: Uint16Array;
  tileId: Uint16Array;
  state: Uint8Array;
  metadata: Uint8Array;
  prevTileId: Uint16Array;
  prevState: Uint8Array;
  prevMetadata: Uint8Array;
  // Production outputs from buildings whose cycle completed this tick. Empty
  // for chunks with no buildings, which is the common case.
  productionEvents: ProductionEvent[];
}

export interface SimScratch {
  indices: Uint16Array;
  tileId: Uint16Array;
  state: Uint8Array;
  metadata: Uint8Array;
  prevTileId: Uint16Array;
  prevState: Uint8Array;
  prevMetadata: Uint8Array;
}

export function allocSimScratch(): SimScratch {
  return {
    indices: new Uint16Array(TILES_PER_CHUNK),
    tileId: new Uint16Array(TILES_PER_CHUNK),
    state: new Uint8Array(TILES_PER_CHUNK),
    metadata: new Uint8Array(TILES_PER_CHUNK),
    prevTileId: new Uint16Array(TILES_PER_CHUNK),
    prevState: new Uint8Array(TILES_PER_CHUNK),
    prevMetadata: new Uint8Array(TILES_PER_CHUNK),
  };
}

function growthInterval(baseRate: number): number {
  if (baseRate <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(1, Math.round(1 / baseRate));
}

export function simulateChunkTick(chunk: ChunkData, tick: number, scratch: SimScratch): SimDelta {
  let count = 0;
  const productionEvents: ProductionEvent[] = [];

  for (let i = 0; i < TILES_PER_CHUNK; i++) {
    const tileId = chunk.tileId[i] ?? 0;

    // ---- Crop tick ----
    const crop = cropForTile(tileId);
    if (crop) {
      const state = chunk.state[i] ?? 0;
      if (state === CROP_STATE_WILTED) continue;

      const meta = chunk.metadata[i] ?? 0;
      const water = getWaterLevel(meta);

      let nextState = state;
      let nextMeta = meta;
      let changed = false;

      if (state < CROP_STAGE_HARVESTABLE && water > 0 && tick > 0) {
        if (tick % growthInterval(crop.baseRate) === 0) {
          nextState = state + 1;
          changed = true;
        }
      }

      if (water > 0 && tick > 0 && tick % WATER_DECAY_INTERVAL === 0) {
        nextMeta = setWaterLevel(meta, water - 1);
        if (nextMeta !== meta) changed = true;
      }

      if (changed) {
        scratch.indices[count] = i;
        scratch.tileId[count] = tileId;
        scratch.state[count] = nextState;
        scratch.metadata[count] = nextMeta;
        scratch.prevTileId[count] = tileId;
        scratch.prevState[count] = state;
        scratch.prevMetadata[count] = meta;
        count++;
      }
      continue;
    }

    // ---- Building tick ----
    const building = buildingForTile(tileId);
    if (building) {
      const progress = chunk.state[i] ?? 0;
      const meta = chunk.metadata[i] ?? 0;
      const queued = getQueuedJobs(meta);

      let nextProgress = progress;
      let nextMeta = meta;
      let changed = false;

      if (progress === BUILDING_STATE_IDLE) {
        // Idle: start the next job if anything is queued.
        if (queued > 0) {
          nextProgress = 1; // begin cycle
          nextMeta = setQueuedJobs(meta, queued - 1);
          changed = true;
        }
      } else if (progress >= building.cycleTime) {
        // Cycle finished: emit production event and return to idle.
        productionEvents.push({
          tileIndex: i,
          expectedTileId: tileId,
          itemId: building.outputItem,
          quantity: building.outputQuantity,
        });
        nextProgress = BUILDING_STATE_IDLE;
        changed = true;
        // If more queued, the next idle tick picks them up — keeps the
        // cycle visible (one tick of "idle" between jobs). Acceptable for
        // Phase 4 pacing (30s mill cycle dwarfs the 1s gap).
      } else {
        // In progress: advance one tick. cycleTime is bounded by Uint8 max
        // (255) and our defs cap at 90, so no overflow.
        nextProgress = progress + 1;
        changed = true;
      }

      if (changed) {
        scratch.indices[count] = i;
        scratch.tileId[count] = tileId;
        scratch.state[count] = nextProgress;
        scratch.metadata[count] = nextMeta;
        scratch.prevTileId[count] = tileId;
        scratch.prevState[count] = progress;
        scratch.prevMetadata[count] = meta;
        count++;
      }
    }
  }

  return {
    count,
    indices: scratch.indices,
    tileId: scratch.tileId,
    state: scratch.state,
    metadata: scratch.metadata,
    prevTileId: scratch.prevTileId,
    prevState: scratch.prevState,
    prevMetadata: scratch.prevMetadata,
    productionEvents,
  };
}

// Apply a sim delta to the live chunk. Race-aware: each entry's prev*
// fields record what the sim observed; if any of (tileId, state,
// metadata) at that index changed during the worker's in-flight window
// (i.e. the player tilled / planted / watered / harvested / fed /
// dismantled that tile), the live values won't match prev and we drop
// the sim's update for that tile. Returns the number of entries
// actually applied — useful for tests and future telemetry.
export function applySimDelta(chunk: ChunkData, delta: SimDelta): number {
  let applied = 0;
  for (let n = 0; n < delta.count; n++) {
    const idx = delta.indices[n] as number;
    if (chunk.tileId[idx] !== (delta.prevTileId[n] as number)) continue;
    if (chunk.state[idx] !== (delta.prevState[n] as number)) continue;
    if (chunk.metadata[idx] !== (delta.prevMetadata[n] as number)) continue;
    chunk.tileId[idx] = delta.tileId[n] as number;
    chunk.state[idx] = delta.state[n] as number;
    chunk.metadata[idx] = delta.metadata[n] as number;
    applied++;
  }
  return applied;
}
