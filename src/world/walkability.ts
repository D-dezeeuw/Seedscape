// Entity walkability test — used by wander AI and (later) possessed-avatar
// movement to decide whether a tile is reachable. Conservative for MVP:
// water and placed buildings block, everything else is walkable.
//
// Crops and tilled farmland are walkable — players in farming sims are
// used to walking over their crops without trampling them. Marsh / soft
// ground is walkable for entities even though it's non-buildable, so a
// villager near the river can wander through it.

import { type ChunkData, TILES_PER_CHUNK } from "./chunk";

const SHALLOW_WATER = 0;
const DEEP_WATER = 1;
const SWAMP_WATER = 30;

export function isEntityWalkable(tileId: number): boolean {
  // Buildings (200..299) block.
  if (tileId >= 200 && tileId <= 299) return false;
  // Water tiles block.
  if (tileId === SHALLOW_WATER || tileId === DEEP_WATER || tileId === SWAMP_WATER) return false;
  return true;
}

// True for tiles a HAUL_WATER job can fetch from. Wells (tile id reserved by
// building registry) and shallow water both count; deep water and swamp don't
// — settlers can't reach the middle of a river. Kept here so the pathfinder
// worker and main-thread emitters share the same test.
const WELL_TILE = 201;
export function isWaterSource(tileId: number): boolean {
  return tileId === SHALLOW_WATER || tileId === WELL_TILE;
}

// Pack a chunk's walkability into a Uint8Array(1024) — 1 = walkable, 0 = blocked.
// Both the main thread (job emitter scans) and the pathfinding worker call this
// via the same canonical isEntityWalkable, so the mask cannot drift from the
// gameplay rule. Caller may pass a reusable scratch buffer to avoid allocation.
export function buildChunkMask(chunk: ChunkData, out?: Uint8Array): Uint8Array {
  const mask = out ?? new Uint8Array(TILES_PER_CHUNK);
  for (let i = 0; i < TILES_PER_CHUNK; i++) {
    mask[i] = isEntityWalkable(chunk.tileId[i] ?? 0) ? 1 : 0;
  }
  return mask;
}
