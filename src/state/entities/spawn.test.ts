import { describe, expect, test } from "vitest";
import { CHUNK_SIZE, tileIndex } from "../../world/chunk";
import { EntityManager } from "./entity_manager";
import { spawnInitialEntities } from "./spawn";
import type { Villager } from "./villager";

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
  const a = new Uint16Array(CHUNK_SIZE * CHUNK_SIZE);
  a.fill(11); // rich soil
  return a;
}

describe("spawnInitialEntities", () => {
  test("spawns the Settler at (16,16) and a named companion nearby", async () => {
    const chunkManager = makeChunkManager(tilesAllWalkable());
    const entityManager = new EntityManager();
    const villagers = await spawnInitialEntities({
      // biome-ignore lint/suspicious/noExplicitAny: minimal duck-typed stub
      chunkManager: chunkManager as any,
      entityManager,
      worldSeed: 12345,
    });
    expect(villagers.length).toBe(2);
    const [settler, companion] = villagers as [Villager, Villager];
    expect(settler.name).toBe("Settler");
    expect(settler.localX).toBe(16.5);
    expect(settler.localY).toBe(16.5);

    // Companion is on a different tile and has a name from the pool.
    expect(companion.name).not.toBe("Settler");
    expect(companion.name).not.toBe("");
    expect(companion.localX !== settler.localX || companion.localY !== settler.localY).toBe(true);
  });

  test("settler BFS skirts an unwalkable origin tile", async () => {
    const tiles = tilesAllWalkable();
    tiles[tileIndex(16, 16)] = 1; // deep water
    const chunkManager = makeChunkManager(tiles);
    const entityManager = new EntityManager();
    const villagers = await spawnInitialEntities({
      // biome-ignore lint/suspicious/noExplicitAny: minimal duck-typed stub
      chunkManager: chunkManager as any,
      entityManager,
      worldSeed: 1,
    });
    const settler = villagers[0] as Villager;
    expect(!(settler.localX === 16.5 && settler.localY === 16.5)).toBe(true);
  });
});
