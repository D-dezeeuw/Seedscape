import { describe, expect, test } from "vitest";
import { CHUNK_SIZE, type ChunkData, tileIndex } from "../../world/chunk";
import { EntityManager } from "./entity_manager";
import { spawnInitialEntities } from "./spawn";
import type { Villager } from "./villager";

const TILE_FARMLAND_TILLED = 13;

function makeChunkManager(data: ChunkData) {
  return {
    peekChunk(cx: number, cy: number) {
      if (cx !== 0 || cy !== 0) return null;
      return { data };
    },
  };
}

function tilesAllWalkable(): ChunkData {
  // Real-shaped chunk so the spawn function can read state + metadata
  // when stamping tilled tiles. Mirrors what allocChunkData would
  // produce for a freshly generated grass chunk.
  return {
    tileId: new Uint16Array(CHUNK_SIZE * CHUNK_SIZE).fill(11), // rich soil
    state: new Uint8Array(CHUNK_SIZE * CHUNK_SIZE),
    metadata: new Uint8Array(CHUNK_SIZE * CHUNK_SIZE),
  };
}

describe("spawnInitialEntities", () => {
  test("spawns two settlers with random names + a 2×2 starter farm patch", async () => {
    const data = tilesAllWalkable();
    const chunkManager = makeChunkManager(data);
    const entityManager = new EntityManager();
    const result = await spawnInitialEntities({
      // biome-ignore lint/suspicious/noExplicitAny: minimal duck-typed stub
      chunkManager: chunkManager as any,
      entityManager,
      worldSeed: 12345,
    });

    expect(result.villagers.length).toBe(2);
    const [settler, companion] = result.villagers as [Villager, Villager];
    // Both names come from the random pool — no hardcoded "Settler".
    expect(settler.name).not.toBe("Settler");
    expect(companion.name).not.toBe("Settler");
    expect(settler.name.length).toBeGreaterThan(0);
    expect(companion.name.length).toBeGreaterThan(0);
    // First settler lands on the chunk centre when (16,16) is walkable.
    expect(settler.localX).toBe(16.5);
    expect(settler.localY).toBe(16.5);
    // Companion is on a different tile.
    expect(companion.localX !== settler.localX || companion.localY !== settler.localY).toBe(true);

    // 2×2 patch placed southwest of the first settler. With chunk
    // centre at (16,16), patch sits at (13..14, 16..17).
    const patchTiles = [
      { x: 13, y: 16 },
      { x: 14, y: 16 },
      { x: 13, y: 17 },
      { x: 14, y: 17 },
    ];
    for (const t of patchTiles) {
      expect(data.tileId[tileIndex(t.x, t.y)]).toBe(TILE_FARMLAND_TILLED);
      // Empty tilled = state 0 (no crop planted yet).
      expect(data.state[tileIndex(t.x, t.y)]).toBe(0);
    }

    // mutatedChunks reports chunk(0,0) so main.ts marks it dirty.
    expect(result.mutatedChunks).toEqual([{ chunkX: 0, chunkY: 0 }]);
  });

  test("settler BFS skirts an unwalkable origin tile", async () => {
    const data = tilesAllWalkable();
    data.tileId[tileIndex(16, 16)] = 1; // deep water
    const chunkManager = makeChunkManager(data);
    const entityManager = new EntityManager();
    const result = await spawnInitialEntities({
      // biome-ignore lint/suspicious/noExplicitAny: minimal duck-typed stub
      chunkManager: chunkManager as any,
      entityManager,
      worldSeed: 1,
    });
    const settler = result.villagers[0] as Villager;
    expect(!(settler.localX === 16.5 && settler.localY === 16.5)).toBe(true);
  });

  test("same worldSeed produces deterministic settler names", async () => {
    // Spawn twice with the same seed; names should match. Replays /
    // save-version migrations rely on this.
    const runOnce = async (): Promise<[string, string]> => {
      const data = tilesAllWalkable();
      const chunkManager = makeChunkManager(data);
      const entityManager = new EntityManager();
      const result = await spawnInitialEntities({
        // biome-ignore lint/suspicious/noExplicitAny: minimal duck-typed stub
        chunkManager: chunkManager as any,
        entityManager,
        worldSeed: 7777,
      });
      const [a, b] = result.villagers as [Villager, Villager];
      return [a.name, b.name];
    };
    const a = await runOnce();
    const b = await runOnce();
    expect(a).toEqual(b);
  });
});
