import { describe, expect, test } from "vitest";
import { ITEM_IDS } from "../../state/items";
import { allocChunkData, type ChunkRecord, tileIndex } from "../chunk";
import { chunkKey } from "../coords";
import { BuildingBufferStore, INPUT_BUFFER_MULTIPLIER } from "./building_buffer";
import { autoQueueFromBuffers } from "./building_buffer_tick";
import { buildingForTile, getQueuedJobs } from "./building_registry";

const MILL_TILE = 200;

function singleChunkSource(record: ChunkRecord): {
  allChunkRecords(): IterableIterator<[string, ChunkRecord]>;
} {
  const map = new Map<string, ChunkRecord>([[chunkKey(0, 0), record]]);
  return {
    *allChunkRecords() {
      yield* map;
    },
  };
}

describe("autoQueueFromBuffers", () => {
  test("drains one cycle's worth of input into queued counter", () => {
    const data = allocChunkData();
    data.tileId[tileIndex(5, 5)] = MILL_TILE;
    const record: ChunkRecord = { data, flags: 0 };
    const chunks = singleChunkSource(record);

    const buffers = new BuildingBufferStore();
    const def = buildingForTile(MILL_TILE);
    if (!def) throw new Error("mill def missing — registry regressed");
    buffers.addInput(
      5,
      5,
      ITEM_IDS.WHEAT,
      def.inputQuantity,
      def.inputQuantity * INPUT_BUFFER_MULTIPLIER,
    );

    const enqueued = autoQueueFromBuffers(chunks, buffers);
    expect(enqueued).toBe(1);
    expect(getQueuedJobs(data.metadata[tileIndex(5, 5)] ?? 0)).toBe(1);
    expect(buffers.totalInputAt(5, 5)).toBe(0);
  });

  test("partial input below cycleInput is left untouched", () => {
    const data = allocChunkData();
    data.tileId[tileIndex(2, 2)] = MILL_TILE;
    const record: ChunkRecord = { data, flags: 0 };
    const chunks = singleChunkSource(record);

    const buffers = new BuildingBufferStore();
    const def = buildingForTile(MILL_TILE);
    if (!def) throw new Error("mill def missing");
    // Mill needs 3 wheat; deposit only 2.
    buffers.addInput(2, 2, ITEM_IDS.WHEAT, def.inputQuantity - 1, 100);

    const enqueued = autoQueueFromBuffers(chunks, buffers);
    expect(enqueued).toBe(0);
    expect(getQueuedJobs(data.metadata[tileIndex(2, 2)] ?? 0)).toBe(0);
    expect(buffers.totalInputAt(2, 2)).toBe(def.inputQuantity - 1);
  });

  test("respects per-building queued cap = INPUT_BUFFER_MULTIPLIER", () => {
    const data = allocChunkData();
    data.tileId[tileIndex(0, 0)] = MILL_TILE;
    const record: ChunkRecord = { data, flags: 0 };
    const chunks = singleChunkSource(record);
    const buffers = new BuildingBufferStore();
    const def = buildingForTile(MILL_TILE);
    if (!def) throw new Error("mill def missing");

    // Deposit way more than the cap; running auto-queue many times
    // should plateau at INPUT_BUFFER_MULTIPLIER queued cycles.
    buffers.addInput(0, 0, ITEM_IDS.WHEAT, def.inputQuantity * 10, def.inputQuantity * 10);
    for (let i = 0; i < 20; i++) autoQueueFromBuffers(chunks, buffers);

    expect(getQueuedJobs(data.metadata[tileIndex(0, 0)] ?? 0)).toBe(INPUT_BUFFER_MULTIPLIER);
  });

  test("ignores passive containers (crate/dispenser)", () => {
    const data = allocChunkData();
    data.tileId[tileIndex(1, 1)] = 220; // crate
    data.tileId[tileIndex(2, 2)] = 221; // dispenser
    const record: ChunkRecord = { data, flags: 0 };
    const chunks = singleChunkSource(record);

    const buffers = new BuildingBufferStore();
    // Buffers are nonsense for passive tiles, but test that the tick
    // doesn't accidentally try to enqueue them.
    buffers.addInput(1, 1, ITEM_IDS.WHEAT, 99, 100);
    buffers.addInput(2, 2, ITEM_IDS.WHEAT_SEED, 99, 100);

    expect(autoQueueFromBuffers(chunks, buffers)).toBe(0);
  });

  test("marks chunk dirty only when at least one cycle was queued", () => {
    const data = allocChunkData();
    data.tileId[tileIndex(5, 5)] = MILL_TILE;
    const record: ChunkRecord = { data, flags: 0 };
    const chunks = singleChunkSource(record);
    const buffers = new BuildingBufferStore();

    // First pass: empty buffer → no change → flags unchanged.
    autoQueueFromBuffers(chunks, buffers);
    expect(record.flags).toBe(0);

    // Now feed enough for a cycle and re-tick.
    const def = buildingForTile(MILL_TILE);
    if (!def) throw new Error("mill def missing");
    buffers.addInput(5, 5, ITEM_IDS.WHEAT, def.inputQuantity, 100);
    autoQueueFromBuffers(chunks, buffers);
    expect(record.flags).not.toBe(0);
  });
});
