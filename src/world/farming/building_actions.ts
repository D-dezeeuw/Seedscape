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
// Tiles a player is allowed to build on. Tilled farmland is the only Phase 4
// surface — no obstructing water, no pre-existing crops/buildings.
const BUILDABLE_TILE_IDS = new Set<number>([TILE_FARMLAND_TILLED]);

export interface BuildingActionResult {
  applied: boolean;
}

export function isBuildable(tileId: number, state: number): boolean {
  return BUILDABLE_TILE_IDS.has(tileId) && state === 0;
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
