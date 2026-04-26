import { describe, expect, test } from "vitest";
import { CHUNK_SIZE, tileIndex } from "../../world/chunk";
import { EntityManager } from "./entity_manager";
import { spawnSettler } from "./spawn";
import { Villager } from "./villager";

// Minimal stand-in for ChunkManager.peekChunk — just enough surface to
// satisfy spawnSettler's `chunkManager.peekChunk(0,0)` lookup.
function makeChunkManager(tileId: Uint16Array) {
  return {
    peekChunk(cx: number, cy: number) {
      if (cx !== 0 || cy !== 0) return null;
      return {
        data: { tileId, state: new Uint8Array(0), metadata: new Uint8Array(0) },
      };
    },
  };
}

function tilesAllWalkable(): Uint16Array {
  // Tile id 11 (rich soil) is walkable per isEntityWalkable.
  const a = new Uint16Array(CHUNK_SIZE * CHUNK_SIZE);
  a.fill(11);
  return a;
}

describe("spawnSettler", () => {
  test("places a villager on a walkable tile near (16,16)", async () => {
    const chunkManager = makeChunkManager(tilesAllWalkable());
    const entityManager = new EntityManager();
    // biome-ignore lint/suspicious/noExplicitAny: minimal duck-typed stub
    const settler = await spawnSettler({ chunkManager: chunkManager as any, entityManager });
    expect(settler).toBeInstanceOf(Villager);
    expect(entityManager.size()).toBe(1);
    expect(settler?.chunkX).toBe(0);
    expect(settler?.chunkY).toBe(0);
    // Center spawn on all-walkable means it lands at exactly (16, 16).
    expect(settler?.localX).toBe(16.5);
    expect(settler?.localY).toBe(16.5);
  });

  test("BFS skirts an unwalkable patch around the center", async () => {
    const tiles = tilesAllWalkable();
    // Block (16,16) with deep water; settler should land on a neighbor.
    tiles[tileIndex(16, 16)] = 1;
    const chunkManager = makeChunkManager(tiles);
    const entityManager = new EntityManager();
    // biome-ignore lint/suspicious/noExplicitAny: minimal duck-typed stub
    const settler = await spawnSettler({ chunkManager: chunkManager as any, entityManager });
    expect(settler).toBeTruthy();
    const { localX, localY } = settler as Villager;
    // Whatever neighbor was picked, it must not be the blocked tile.
    expect(!(localX === 16.5 && localY === 16.5)).toBe(true);
    // And it must be adjacent (Manhattan distance 1 in tile units).
    const dx = Math.abs(localX - 16.5);
    const dy = Math.abs(localY - 16.5);
    expect(dx + dy).toBeCloseTo(1, 5);
  });
});
