import { describe, expect, test } from "vitest";
import { Inventory } from "../../state/inventory";
import { ITEM_IDS } from "../../state/items";
import { allocChunkData, CHUNK_FLAG_DIRTY_RENDER, type ChunkRecord, tileIndex } from "../chunk";
import { chunkKey } from "../coords";
import { SEED_DISPENSER_TILE_ID } from "./container_registry";
import { CRATE_TILE_ID, CrateStore } from "./crate";
import { PER_ITEM_RESTOCK_CAP, restockAutoContainers } from "./restock";

function makeChunks(records: Array<[string, ChunkRecord]>) {
  return {
    *allChunkRecords() {
      yield* records;
    },
  };
}

function chunkWithTile(cx: number, cy: number, lx: number, ly: number, tileId: number) {
  const data = allocChunkData();
  for (let i = 0; i < data.tileId.length; i++) data.tileId[i] = 10; // grass
  data.tileId[tileIndex(lx, ly)] = tileId;
  const record: ChunkRecord = { data, flags: CHUNK_FLAG_DIRTY_RENDER };
  return { key: chunkKey(cx, cy), record };
}

describe("restockAutoContainers", () => {
  test("dispensers pull seeds from inventory up to per-item cap", () => {
    const { key, record } = chunkWithTile(0, 0, 4, 4, SEED_DISPENSER_TILE_ID);
    const chunks = makeChunks([[key, record]]);
    const inv = new Inventory();
    inv.add(ITEM_IDS.WHEAT_SEED, 100);
    const crates = new CrateStore();
    const moved = restockAutoContainers(chunks, inv, crates);
    expect(moved).toBe(PER_ITEM_RESTOCK_CAP);
    expect(crates.countAt(4, 4, ITEM_IDS.WHEAT_SEED)).toBe(PER_ITEM_RESTOCK_CAP);
    expect(inv.count(ITEM_IDS.WHEAT_SEED)).toBe(100 - PER_ITEM_RESTOCK_CAP);
  });

  test("crates do not auto-restock", () => {
    const { key, record } = chunkWithTile(0, 0, 5, 5, CRATE_TILE_ID);
    const chunks = makeChunks([[key, record]]);
    const inv = new Inventory();
    inv.add(ITEM_IDS.WHEAT_SEED, 50);
    const crates = new CrateStore();
    const moved = restockAutoContainers(chunks, inv, crates);
    expect(moved).toBe(0);
    expect(crates.totalAt(5, 5)).toBe(0);
    expect(inv.count(ITEM_IDS.WHEAT_SEED)).toBe(50);
  });

  test("dispensers reject non-seeds (e.g. produce)", () => {
    const { key, record } = chunkWithTile(0, 0, 4, 4, SEED_DISPENSER_TILE_ID);
    const chunks = makeChunks([[key, record]]);
    const inv = new Inventory();
    inv.add(ITEM_IDS.WHEAT, 50); // produce, not seed
    const crates = new CrateStore();
    expect(restockAutoContainers(chunks, inv, crates)).toBe(0);
    expect(crates.totalAt(4, 4)).toBe(0);
  });

  test("balances multiple seed types up to each per-item cap", () => {
    const { key, record } = chunkWithTile(0, 0, 4, 4, SEED_DISPENSER_TILE_ID);
    const chunks = makeChunks([[key, record]]);
    const inv = new Inventory();
    inv.add(ITEM_IDS.WHEAT_SEED, 100);
    inv.add(ITEM_IDS.CARROT_SEED, 100);
    const crates = new CrateStore();
    restockAutoContainers(chunks, inv, crates);
    expect(crates.countAt(4, 4, ITEM_IDS.WHEAT_SEED)).toBe(PER_ITEM_RESTOCK_CAP);
    expect(crates.countAt(4, 4, ITEM_IDS.CARROT_SEED)).toBe(PER_ITEM_RESTOCK_CAP);
  });

  test("subsequent calls top up but never exceed the cap", () => {
    const { key, record } = chunkWithTile(0, 0, 4, 4, SEED_DISPENSER_TILE_ID);
    const chunks = makeChunks([[key, record]]);
    const inv = new Inventory();
    inv.add(ITEM_IDS.WHEAT_SEED, 100);
    const crates = new CrateStore();
    restockAutoContainers(chunks, inv, crates);
    // Drain a few to simulate settler withdraws, then re-stock.
    crates.withdraw(4, 4, ITEM_IDS.WHEAT_SEED, 5);
    const moved = restockAutoContainers(chunks, inv, crates);
    expect(moved).toBe(5);
    expect(crates.countAt(4, 4, ITEM_IDS.WHEAT_SEED)).toBe(PER_ITEM_RESTOCK_CAP);
  });

  test("zero cost when no auto-restock containers exist", () => {
    const data = allocChunkData();
    for (let i = 0; i < data.tileId.length; i++) data.tileId[i] = 10;
    const record: ChunkRecord = { data, flags: CHUNK_FLAG_DIRTY_RENDER };
    const chunks = makeChunks([[chunkKey(0, 0), record]]);
    const inv = new Inventory();
    inv.add(ITEM_IDS.WHEAT_SEED, 50);
    const crates = new CrateStore();
    expect(restockAutoContainers(chunks, inv, crates)).toBe(0);
    expect(inv.count(ITEM_IDS.WHEAT_SEED)).toBe(50);
  });
});
