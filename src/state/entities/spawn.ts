// Helpers for placing entities into a freshly-generated world. Used by
// main.ts on first launch. Subsequent launches restore entities from
// the save snapshot — these helpers don't run on a loaded world.

import { CHUNK_SIZE, type ChunkData, tileIndex } from "../../world/chunk";
import type { ChunkManager } from "../../world/chunk_manager";
import { isEntityWalkable } from "../../world/walkability";
import type { EntityManager } from "./entity_manager";
import type { Gender } from "./names";
import { pickFullName } from "./names";
import { Villager } from "./villager";

const CHUNK_LOAD_TIMEOUT_MS = 5000;
const CHUNK_LOAD_POLL_MS = 100;

// Tile id for tilled farmland — the player's "ready to plant" surface.
// Mirrored from world/farming/tile_actions; copied here to keep this
// module's import surface narrow (no farming logic, just a tile id).
const TILE_FARMLAND_TILLED = 13;

// BFS out from (centerX, centerY) until a walkable tile is found.
// `excluded` is a set of "y * CHUNK_SIZE + x" indices the caller wants
// to skip (used to spread multiple spawns across distinct tiles).
function findWalkableLocal(
  data: ChunkData,
  centerX: number,
  centerY: number,
  excluded: Set<number> = new Set(),
): { x: number; y: number } | null {
  const visited = new Set<number>();
  const queue: Array<{ x: number; y: number }> = [{ x: centerX, y: centerY }];
  while (queue.length > 0) {
    const { x, y } = queue.shift() as { x: number; y: number };
    if (x < 0 || y < 0 || x >= CHUNK_SIZE || y >= CHUNK_SIZE) continue;
    const key = y * CHUNK_SIZE + x;
    if (visited.has(key)) continue;
    visited.add(key);
    const id = data.tileId[tileIndex(x, y)] ?? 0;
    if (!excluded.has(key) && isEntityWalkable(id)) return { x, y };
    queue.push({ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 });
  }
  return null;
}

async function waitForChunk(
  chunkManager: ChunkManager,
  chunkX: number,
  chunkY: number,
): Promise<ChunkData | null> {
  const start = Date.now();
  while (Date.now() - start < CHUNK_LOAD_TIMEOUT_MS) {
    const record = chunkManager.peekChunk(chunkX, chunkY);
    if (record) return record.data;
    await new Promise((resolve) => setTimeout(resolve, CHUNK_LOAD_POLL_MS));
  }
  return null;
}

function placeVillager(
  entityManager: EntityManager,
  local: { x: number; y: number },
  name: string,
  gender: Gender = "male",
): Villager {
  const villager = new Villager(
    entityManager.allocateId(),
    { chunkX: 0, chunkY: 0, localX: local.x + 0.5, localY: local.y + 0.5 },
    name,
    { x: local.x, y: local.y },
  );
  villager.gender = gender;
  entityManager.add(villager);
  return villager;
}

export interface SpawnInitialOptions {
  chunkManager: ChunkManager;
  entityManager: EntityManager;
  worldSeed: number;
}

export interface SpawnInitialResult {
  villagers: Villager[];
  // Chunk coords whose tile data was mutated during spawn (the starter
  // farm patch). Caller marks these dirty for render + sim. Empty when
  // nothing was placed — e.g., chunk(0,0) never loaded, or the patch
  // location wasn't walkable.
  mutatedChunks: Array<{ chunkX: number; chunkY: number }>;
}

// First-launch spawn. Drops two settlers with random Dutch names at
// chunk(0,0) plus a 2×2 patch of tilled farmland next to them. The
// player has 100 wheat seeds at start so they can plant immediately;
// without containers the settlers can't auto-harvest yet — that's the
// intended early game (player runs the farm by hand until they build
// a Storage Crate, at which point Phase 7 autonomy kicks in).
//
// Pre-Phase-8 behavior was a single hardcoded "Settler" + a random
// companion + no plots, which left the new world looking inert because
// the autonomous job loop is gated on having a container. The starter
// patch makes the loop visible from frame one.
//
// Subsequent launches restore from the save snapshot — applySnapshot
// bypasses this entirely.
export async function spawnInitialEntities(opts: SpawnInitialOptions): Promise<SpawnInitialResult> {
  const data = await waitForChunk(opts.chunkManager, 0, 0);
  if (!data) {
    console.warn("spawnInitialEntities: chunk(0,0) never loaded");
    return { villagers: [], mutatedChunks: [] };
  }

  const settlerLocal = findWalkableLocal(data, 16, 16);
  if (!settlerLocal) {
    console.warn("spawnInitialEntities: no walkable tile near origin");
    return { villagers: [], mutatedChunks: [] };
  }
  // First settler — random name from data/names.json. Seeded directly
  // off worldSeed so the same world replays the same spawn names.
  const firstPicked = pickFullName(opts.worldSeed);
  const settler = placeVillager(
    opts.entityManager,
    settlerLocal,
    firstPicked.name,
    firstPicked.gender,
  );

  const taken = new Set<number>([settlerLocal.y * CHUNK_SIZE + settlerLocal.x]);
  // Companion a few tiles south-east so they aren't on top of the
  // first settler. Falls back to "near first settler" via BFS skipping
  // the first settler's tile.
  const companionLocal =
    findWalkableLocal(data, settlerLocal.x + 4, settlerLocal.y + 3, taken) ??
    findWalkableLocal(data, settlerLocal.x, settlerLocal.y, taken);
  if (!companionLocal) return { villagers: [settler], mutatedChunks: [] };

  // Different seed mix than the first settler so the two settlers
  // almost always pick distinct names. With ~100 first names and a
  // 32-bit seed space the collision rate is on the order of 1%.
  const companionPicked = pickFullName(opts.worldSeed ^ 0x9e37);
  const companion = placeVillager(
    opts.entityManager,
    companionLocal,
    companionPicked.name,
    companionPicked.gender,
  );

  const patch = placeStarterFarmPatch(data, settlerLocal);

  return {
    villagers: [settler, companion],
    mutatedChunks: patch > 0 ? [{ chunkX: 0, chunkY: 0 }] : [],
  };
}

// Drops up to 4 tilled-farmland tiles in a 2×2 patch a few tiles
// southwest of the first settler so the player can immediately
// see + plant on them. Tiles that aren't walkable (water, fixed
// obstacles) are skipped — a partial patch is fine. Returns the
// number of tiles actually placed.
function placeStarterFarmPatch(data: ChunkData, settlerLocal: { x: number; y: number }): number {
  const baseX = settlerLocal.x - 3;
  const baseY = settlerLocal.y;
  let placed = 0;
  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 0; dx < 2; dx++) {
      const lx = baseX + dx;
      const ly = baseY + dy;
      if (lx < 0 || ly < 0 || lx >= CHUNK_SIZE || ly >= CHUNK_SIZE) continue;
      const i = tileIndex(lx, ly);
      const id = data.tileId[i] ?? 0;
      if (!isEntityWalkable(id)) continue;
      data.tileId[i] = TILE_FARMLAND_TILLED;
      data.state[i] = 0;
      data.metadata[i] = 0;
      placed++;
    }
  }
  return placed;
}
