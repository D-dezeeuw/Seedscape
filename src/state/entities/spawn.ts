// Helpers for placing entities into a freshly-generated world. Used by
// main.ts on first launch. Subsequent launches restore entities from the
// save snapshot — these helpers don't run on a loaded world.
//
// Today: just the settler spawn. As more characters land (companions,
// arrivals, animals) they get colocated here.

import { CHUNK_SIZE, type ChunkData, tileIndex } from "../../world/chunk";
import type { ChunkManager } from "../../world/chunk_manager";
import { isEntityWalkable } from "../../world/walkability";
import type { EntityManager } from "./entity_manager";
import { Villager } from "./villager";

const CHUNK_LOAD_TIMEOUT_MS = 5000;
const CHUNK_LOAD_POLL_MS = 100;

// Spirals out from (centerX, centerY) within a single chunk until it hits
// a walkable tile, returning local coords. Null if every tile in the
// chunk is non-walkable (extreme world-gen edge case).
function findWalkableLocal(
  data: ChunkData,
  centerX: number,
  centerY: number,
): { x: number; y: number } | null {
  // BFS over Manhattan rings up to chunk-radius.
  const visited = new Set<number>();
  const queue: Array<{ x: number; y: number }> = [{ x: centerX, y: centerY }];
  while (queue.length > 0) {
    const { x, y } = queue.shift() as { x: number; y: number };
    if (x < 0 || y < 0 || x >= CHUNK_SIZE || y >= CHUNK_SIZE) continue;
    const key = y * CHUNK_SIZE + x;
    if (visited.has(key)) continue;
    visited.add(key);
    const id = data.tileId[tileIndex(x, y)] ?? 0;
    if (isEntityWalkable(id)) return { x, y };
    queue.push({ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 });
  }
  return null;
}

// Resolves once chunk(0,0) is loaded (or the timeout elapses). Spawning
// any earlier risks placing a villager on the loading-placeholder.
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

export interface SpawnSettlerOptions {
  chunkManager: ChunkManager;
  entityManager: EntityManager;
  name?: string;
}

// Drops a Villager named "Settler" near the center of chunk(0,0). The
// home tile is set to whatever walkable tile the spawn landed on, so
// wander stays anchored where the player first sees them.
export async function spawnSettler(opts: SpawnSettlerOptions): Promise<Villager | null> {
  const data = await waitForChunk(opts.chunkManager, 0, 0);
  if (!data) {
    console.warn("spawnSettler: chunk(0,0) never loaded");
    return null;
  }
  const local = findWalkableLocal(data, 16, 16);
  if (!local) {
    console.warn("spawnSettler: no walkable tile in chunk(0,0)");
    return null;
  }
  const villager = new Villager(
    opts.entityManager.allocateId(),
    { chunkX: 0, chunkY: 0, localX: local.x + 0.5, localY: local.y + 0.5 },
    opts.name ?? "Settler",
    { x: local.x, y: local.y },
  );
  opts.entityManager.add(villager);
  return villager;
}
