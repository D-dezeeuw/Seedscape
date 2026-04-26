// Helpers for placing entities into a freshly-generated world. Used by
// main.ts on first launch. Subsequent launches restore entities from
// the save snapshot — these helpers don't run on a loaded world.

import { CHUNK_SIZE, type ChunkData, tileIndex } from "../../world/chunk";
import type { ChunkManager } from "../../world/chunk_manager";
import { isEntityWalkable } from "../../world/walkability";
import type { EntityManager } from "./entity_manager";
import { pickName } from "./names";
import { Villager } from "./villager";

const CHUNK_LOAD_TIMEOUT_MS = 5000;
const CHUNK_LOAD_POLL_MS = 100;

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
): Villager {
  const villager = new Villager(
    entityManager.allocateId(),
    { chunkX: 0, chunkY: 0, localX: local.x + 0.5, localY: local.y + 0.5 },
    name,
    { x: local.x, y: local.y },
  );
  entityManager.add(villager);
  return villager;
}

export interface SpawnInitialOptions {
  chunkManager: ChunkManager;
  entityManager: EntityManager;
  worldSeed: number;
}

// Phase 5 first-launch spawn: the lonely Settler at chunk(0,0) center,
// plus one named companion a few tiles away. Subsequent companions get
// added in later phases (level-gated arrivals).
export async function spawnInitialEntities(opts: SpawnInitialOptions): Promise<Villager[]> {
  const data = await waitForChunk(opts.chunkManager, 0, 0);
  if (!data) {
    console.warn("spawnInitialEntities: chunk(0,0) never loaded");
    return [];
  }

  const settlerLocal = findWalkableLocal(data, 16, 16);
  if (!settlerLocal) {
    console.warn("spawnInitialEntities: no walkable tile near origin");
    return [];
  }
  const settler = placeVillager(opts.entityManager, settlerLocal, "Settler");

  const taken = new Set<number>([settlerLocal.y * CHUNK_SIZE + settlerLocal.x]);
  // Companion seeded a few tiles south-east so they aren't on top of
  // the settler. Falls back to "near settler" via BFS skipping the
  // settler's tile.
  const companionLocal =
    findWalkableLocal(data, settlerLocal.x + 4, settlerLocal.y + 3, taken) ??
    findWalkableLocal(data, settlerLocal.x, settlerLocal.y, taken);
  if (!companionLocal) return [settler];

  const companionName = pickName("villager", opts.worldSeed ^ 0x9e37);
  const companion = placeVillager(opts.entityManager, companionLocal, companionName);
  return [settler, companion];
}
