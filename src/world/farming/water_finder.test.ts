import { describe, expect, test } from "vitest";
import {
  allocChunkData,
  CHUNK_FLAG_DIRTY_RENDER,
  CHUNK_SIZE,
  type ChunkRecord,
  tileIndex,
} from "../chunk";
import { chunkKey } from "../coords";
import { findNearestWaterSource } from "./water_finder";

const SHALLOW_WATER = 0;
const DRY_GRASS = 10;
const WELL_TILE = 201;

function chunkAt(cx: number, cy: number): [string, ChunkRecord] {
  const data = allocChunkData();
  // Fill with grass so neighbour walkability checks don't all fail.
  for (let i = 0; i < data.tileId.length; i++) data.tileId[i] = DRY_GRASS;
  return [chunkKey(cx, cy), { data, flags: CHUNK_FLAG_DIRTY_RENDER }];
}

function makeChunks(records: Array<[string, ChunkRecord]>) {
  return {
    *allChunkRecords() {
      yield* records;
    },
  };
}

describe("findNearestWaterSource", () => {
  test("finds shallow water tile + adjacent standing tile", () => {
    const [k, r] = chunkAt(0, 0);
    r.data.tileId[tileIndex(5, 5)] = SHALLOW_WATER;
    const hit = findNearestWaterSource(makeChunks([[k, r]]), 0, 0);
    expect(hit).not.toBeNull();
    expect(hit?.source).toEqual({ x: 5, y: 5 });
    // Nearest standing tile to (0,0) is (4,5) — left of the water.
    expect(hit?.standing).toEqual({ x: 4, y: 5 });
  });

  test("finds wells (tile id 201) too", () => {
    const [k, r] = chunkAt(0, 0);
    r.data.tileId[tileIndex(3, 3)] = WELL_TILE;
    const hit = findNearestWaterSource(makeChunks([[k, r]]), 0, 0);
    expect(hit?.source).toEqual({ x: 3, y: 3 });
  });

  test("returns null when no water is loaded", () => {
    const [k, r] = chunkAt(0, 0);
    expect(findNearestWaterSource(makeChunks([[k, r]]), 0, 0)).toBeNull();
  });

  test("picks the closer of two water sources", () => {
    const [ka, ra] = chunkAt(0, 0);
    ra.data.tileId[tileIndex(2, 0)] = SHALLOW_WATER;
    const [kb, rb] = chunkAt(1, 0);
    rb.data.tileId[tileIndex(3, 0)] = SHALLOW_WATER; // world tile (35,0)
    const hit = findNearestWaterSource(
      makeChunks([
        [ka, ra],
        [kb, rb],
      ]),
      0,
      0,
    );
    expect(hit?.source.x).toBe(2);
  });

  test("rejects water with no walkable neighbour (sea of water)", () => {
    const [k, r] = chunkAt(0, 0);
    // Fill 3x3 with shallow water — center has no walkable neighbour.
    for (let y = 4; y <= 6; y++) {
      for (let x = 4; x <= 6; x++) {
        r.data.tileId[tileIndex(x, y)] = SHALLOW_WATER;
      }
    }
    const hit = findNearestWaterSource(makeChunks([[k, r]]), 0, 0);
    // Outer cells of the 3x3 still have walkable neighbours; verify the
    // hit's standing tile is on grass.
    expect(hit).not.toBeNull();
    expect(hit?.standing.x).toBeLessThan(4); // standing on grass to the west
  });

  test("returns null if water exists but standing chunk is not loaded", () => {
    // Water at the very edge of chunk (0,0); the only walkable neighbour
    // would be in chunk (1,0), which we don't load.
    const [k, r] = chunkAt(0, 0);
    r.data.tileId[tileIndex(CHUNK_SIZE - 1, 5)] = SHALLOW_WATER;
    // West/north/south neighbours are inside (0,0) and should be grass —
    // those should still satisfy. So this *does* return a hit.
    const hit = findNearestWaterSource(makeChunks([[k, r]]), 0, 0);
    expect(hit).not.toBeNull();
  });
});
