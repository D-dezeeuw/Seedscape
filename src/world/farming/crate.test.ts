import { describe, expect, test } from "vitest";
import { ITEM_IDS } from "../../state/items";
import { allocChunkData, CHUNK_FLAG_DIRTY_RENDER, type ChunkRecord, tileIndex } from "../chunk";
import { chunkKey } from "../coords";
import { isEntityWalkable } from "../walkability";
import { CRATE_CAPACITY, CRATE_TILE_ID, CrateStore } from "./crate";

function makeChunks(records: Array<[string, ChunkRecord]>) {
  return {
    *allChunkRecords() {
      yield* records;
    },
  };
}

const TILE_DRY_GRASS = 10;

function chunkWithCratesAt(
  cx: number,
  cy: number,
  cratePositions: Array<{ lx: number; ly: number }>,
): [string, ChunkRecord] {
  const data = allocChunkData();
  // Default chunk fill is 0 (shallow water = blocked). Lay grass so crate
  // neighbours are walkable; tests need a stand-on tile next to each crate.
  for (let i = 0; i < data.tileId.length; i++) data.tileId[i] = TILE_DRY_GRASS;
  for (const p of cratePositions) data.tileId[tileIndex(p.lx, p.ly)] = CRATE_TILE_ID;
  return [chunkKey(cx, cy), { data, flags: CHUNK_FLAG_DIRTY_RENDER }];
}

describe("crate tile id", () => {
  test("CRATE_TILE_ID lives in the building range and is non-walkable", () => {
    expect(CRATE_TILE_ID).toBeGreaterThanOrEqual(200);
    expect(CRATE_TILE_ID).toBeLessThanOrEqual(299);
    expect(isEntityWalkable(CRATE_TILE_ID)).toBe(false);
  });
});

describe("CrateStore", () => {
  test("empty store reports zero counts", () => {
    const store = new CrateStore();
    expect(store.totalAt(0, 0)).toBe(0);
    expect(store.countAt(0, 0, ITEM_IDS.WHEAT)).toBe(0);
  });

  test("deposit + withdraw round-trip", () => {
    const store = new CrateStore();
    expect(store.deposit(5, 5, ITEM_IDS.WHEAT, 10)).toBe(10);
    expect(store.countAt(5, 5, ITEM_IDS.WHEAT)).toBe(10);
    expect(store.withdraw(5, 5, ITEM_IDS.WHEAT, 4)).toBe(4);
    expect(store.countAt(5, 5, ITEM_IDS.WHEAT)).toBe(6);
  });

  test("deposit clamps to capacity", () => {
    const store = new CrateStore();
    expect(store.deposit(0, 0, ITEM_IDS.WHEAT, CRATE_CAPACITY + 50)).toBe(CRATE_CAPACITY);
    expect(store.deposit(0, 0, ITEM_IDS.CARROT, 10)).toBe(0); // already full
  });

  test("withdraw clamps to available stock", () => {
    const store = new CrateStore();
    store.deposit(1, 1, ITEM_IDS.WHEAT, 5);
    expect(store.withdraw(1, 1, ITEM_IDS.WHEAT, 100)).toBe(5);
    expect(store.totalAt(1, 1)).toBe(0);
  });

  test("multiple item types share capacity", () => {
    const store = new CrateStore();
    store.deposit(0, 0, ITEM_IDS.WHEAT, 100);
    expect(store.deposit(0, 0, ITEM_IDS.CARROT, 200)).toBe(CRATE_CAPACITY - 100);
    expect(store.totalAt(0, 0)).toBe(CRATE_CAPACITY);
  });

  test("withdraw to zero removes the item entry; clearing all empties tile", () => {
    const store = new CrateStore();
    store.deposit(2, 2, ITEM_IDS.WHEAT, 5);
    store.withdraw(2, 2, ITEM_IDS.WHEAT, 5);
    expect(store.countAt(2, 2, ITEM_IDS.WHEAT)).toBe(0);
    expect(Array.from(store.crates()).length).toBe(0);
  });

  test("clearAt drops all contents", () => {
    const store = new CrateStore();
    store.deposit(3, 3, ITEM_IDS.WHEAT, 10);
    store.deposit(3, 3, ITEM_IDS.CARROT, 10);
    store.clearAt(3, 3);
    expect(store.totalAt(3, 3)).toBe(0);
    expect(Array.from(store.crates()).length).toBe(0);
  });

  test("nearestCrateWithRoom finds closest by Manhattan distance", () => {
    const store = new CrateStore();
    const chunks = makeChunks([
      chunkWithCratesAt(0, 0, [
        { lx: 5, ly: 5 },
        { lx: 15, ly: 0 },
      ]),
    ]);
    const hit = store.nearestCrateWithRoom(chunks, 6, 6);
    expect(hit?.crate).toEqual({ x: 5, y: 5 });
    // Closest standing tile from (6, 6) is (6, 5) or (5, 6) — both
    // Manhattan distance 1 from settler. Verify it's adjacent to the crate.
    expect(Math.abs((hit?.standing.x ?? 0) - 5) + Math.abs((hit?.standing.y ?? 0) - 5)).toBe(1);
  });

  test("nearestCrateWithRoom skips full crates", () => {
    const store = new CrateStore();
    const chunks = makeChunks([
      chunkWithCratesAt(0, 0, [
        { lx: 2, ly: 2 },
        { lx: 20, ly: 2 },
      ]),
    ]);
    // Fill the close one to capacity.
    store.deposit(2, 2, ITEM_IDS.WHEAT, CRATE_CAPACITY);
    const hit = store.nearestCrateWithRoom(chunks, 0, 2);
    expect(hit?.crate).toEqual({ x: 20, y: 2 });
  });

  test("nearestCrateWithRoom returns null when no crate tiles exist", () => {
    const store = new CrateStore();
    const chunks = makeChunks([chunkWithCratesAt(0, 0, [])]);
    expect(store.nearestCrateWithRoom(chunks, 0, 0)).toBeNull();
  });

  test("nearestCrateWithRoom returns null when crate has no walkable neighbour", () => {
    const store = new CrateStore();
    // Chunk has crate at (1,1) surrounded by water (the default fill).
    const data = allocChunkData();
    data.tileId[tileIndex(1, 1)] = CRATE_TILE_ID;
    const record: ChunkRecord = { data, flags: CHUNK_FLAG_DIRTY_RENDER };
    const chunks = makeChunks([[chunkKey(0, 0), record]]);
    expect(store.nearestCrateWithRoom(chunks, 0, 0)).toBeNull();
  });

  test("toJSON / loadFromJSON round-trip", () => {
    const a = new CrateStore();
    a.deposit(5, 7, ITEM_IDS.WHEAT, 10);
    a.deposit(5, 7, ITEM_IDS.CARROT, 5);
    a.deposit(-3, 2, ITEM_IDS.BREAD, 8);
    const snap = a.toJSON();

    const b = new CrateStore();
    b.loadFromJSON(snap);
    expect(b.countAt(5, 7, ITEM_IDS.WHEAT)).toBe(10);
    expect(b.countAt(5, 7, ITEM_IDS.CARROT)).toBe(5);
    expect(b.countAt(-3, 2, ITEM_IDS.BREAD)).toBe(8);
    expect(Array.from(b.crates()).length).toBe(2);
  });
});
