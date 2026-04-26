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

  test("nearestContainerForDeposit finds closest by Manhattan distance", () => {
    const store = new CrateStore();
    const chunks = makeChunks([
      chunkWithCratesAt(0, 0, [
        { lx: 5, ly: 5 },
        { lx: 15, ly: 0 },
      ]),
    ]);
    const hit = store.nearestContainerForDeposit(chunks, 6, 6, ITEM_IDS.WHEAT);
    expect(hit?.container).toEqual({ x: 5, y: 5 });
    expect(Math.abs((hit?.standing.x ?? 0) - 5) + Math.abs((hit?.standing.y ?? 0) - 5)).toBe(1);
  });

  test("nearestContainerForDeposit skips full crates", () => {
    const store = new CrateStore();
    const chunks = makeChunks([
      chunkWithCratesAt(0, 0, [
        { lx: 2, ly: 2 },
        { lx: 20, ly: 2 },
      ]),
    ]);
    store.deposit(2, 2, ITEM_IDS.WHEAT, CRATE_CAPACITY);
    const hit = store.nearestContainerForDeposit(chunks, 0, 2, ITEM_IDS.WHEAT);
    expect(hit?.container).toEqual({ x: 20, y: 2 });
  });

  test("nearestContainerForDeposit returns null when no container tiles exist", () => {
    const store = new CrateStore();
    const chunks = makeChunks([chunkWithCratesAt(0, 0, [])]);
    expect(store.nearestContainerForDeposit(chunks, 0, 0, ITEM_IDS.WHEAT)).toBeNull();
  });

  test("nearestContainerForDeposit returns null when crate has no walkable neighbour", () => {
    const store = new CrateStore();
    const data = allocChunkData();
    data.tileId[tileIndex(1, 1)] = CRATE_TILE_ID;
    const record: ChunkRecord = { data, flags: CHUNK_FLAG_DIRTY_RENDER };
    const chunks = makeChunks([[chunkKey(0, 0), record]]);
    expect(store.nearestContainerForDeposit(chunks, 0, 0, ITEM_IDS.WHEAT)).toBeNull();
  });

  test("nearestContainerForDeposit rejects dispenser when item is not a seed", () => {
    const store = new CrateStore();
    const data = allocChunkData();
    for (let i = 0; i < data.tileId.length; i++) data.tileId[i] = 10; // grass
    data.tileId[tileIndex(5, 5)] = 221; // dispenser
    const record: ChunkRecord = { data, flags: CHUNK_FLAG_DIRTY_RENDER };
    // Wheat (produce, 700) should be rejected by dispenser; no crate exists.
    const chunks = makeChunks([[chunkKey(0, 0), record]]);
    expect(store.nearestContainerForDeposit(chunks, 0, 0, ITEM_IDS.WHEAT)).toBeNull();
  });

  test("nearestContainerWithStock finds dispenser holding seeds", () => {
    const store = new CrateStore();
    const data = allocChunkData();
    for (let i = 0; i < data.tileId.length; i++) data.tileId[i] = 10;
    data.tileId[tileIndex(7, 7)] = 221;
    store.deposit(7, 7, ITEM_IDS.WHEAT_SEED, 5);
    const record: ChunkRecord = { data, flags: CHUNK_FLAG_DIRTY_RENDER };
    const chunks = makeChunks([[chunkKey(0, 0), record]]);
    const hit = store.nearestContainerWithStock(chunks, 0, 0, (id) => id === ITEM_IDS.WHEAT_SEED);
    expect(hit?.container).toEqual({ x: 7, y: 7 });
    expect(hit?.itemId).toBe(ITEM_IDS.WHEAT_SEED);
    expect(hit?.count).toBe(5);
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
