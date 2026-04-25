// Pure tile-level functions for building interaction. Each one mutates a
// single tile in a ChunkData and returns whether the action applied.
//
// "Feed" and "dismantle" are the two interactions Phase 4 ships. "Place" is
// handled in tile_interaction directly because it has to know the player's
// coin balance and selected building from the build menu — the chunk-level
// action is just `setBuildingTile`.

import type { ChunkData } from "../chunk";
import { tileIndex } from "../chunk";
import {
  BUILDING_STATE_IDLE,
  type BuildingDef,
  buildingForTile,
  getQueuedJobs,
  setQueuedJobs,
} from "./building_registry";

const TILE_FARMLAND_TILLED = 13;
// Buildings sit on any solid ground tile — anything in the ground id range
// (0..99) that isn't water or soft marsh. Crops (100..199) and existing
// buildings (200..299) are excluded by the id range check.
const NON_BUILDABLE_GROUND_IDS = new Set<number>([
  0, // shallow_water
  1, // deep_water
  30, // swamp_water
  31, // mudflat (soft)
  32, // deltaic_soil (soft marsh)
]);

export interface BuildingActionResult {
  applied: boolean;
}

export function isBuildable(tileId: number, _state: number): boolean {
  if (tileId >= 100) return false; // crops + buildings excluded
  return !NON_BUILDABLE_GROUND_IDS.has(tileId);
}

export function setBuildingTile(
  chunk: ChunkData,
  x: number,
  y: number,
  building: BuildingDef,
): BuildingActionResult {
  const i = tileIndex(x, y);
  const id = chunk.tileId[i] ?? 0;
  const state = chunk.state[i] ?? 0;
  if (!isBuildable(id, state)) return { applied: false };
  chunk.tileId[i] = building.id;
  chunk.state[i] = BUILDING_STATE_IDLE;
  chunk.metadata[i] = setQueuedJobs(0, 0);
  return { applied: true };
}

// Enqueues a single production job at the building. Returns false if the
// queue is already full or the tile isn't a building. Caller is responsible
// for checking + deducting input items from inventory.
export function enqueueJob(chunk: ChunkData, x: number, y: number): BuildingActionResult {
  const i = tileIndex(x, y);
  const tileId = chunk.tileId[i] ?? 0;
  const def = buildingForTile(tileId);
  if (!def) return { applied: false };
  const meta = chunk.metadata[i] ?? 0;
  const queued = getQueuedJobs(meta);
  if (queued >= def.queueSize) return { applied: false };
  chunk.metadata[i] = setQueuedJobs(meta, queued + 1);
  return { applied: true };
}

// Tear down a placed building. Phase 4 doesn't refund coins — discourages
// griefing and keeps the economy simple.
export function dismantleBuilding(chunk: ChunkData, x: number, y: number): BuildingActionResult {
  const i = tileIndex(x, y);
  const tileId = chunk.tileId[i] ?? 0;
  if (!buildingForTile(tileId)) return { applied: false };
  chunk.tileId[i] = TILE_FARMLAND_TILLED;
  chunk.state[i] = 0;
  chunk.metadata[i] = 0;
  return { applied: true };
}
