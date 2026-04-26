import { describe, expect, test } from "vitest";
import {
  allocChunkData,
  CHUNK_FLAG_DIRTY_RENDER,
  CHUNK_SIZE,
  type ChunkRecord,
  tileIndex,
} from "../world/chunk";
import { chunkKey } from "../world/coords";
import { CrateStore } from "../world/farming/crate";
import { CROP_STAGE_HARVESTABLE, CROP_STATE_WILTED } from "../world/farming/crop_registry";
import { setWaterLevel } from "../world/farming/tile_actions";
import { ITEM_IDS } from "./items";
import { DEFAULT_EMITTER_PERIOD_TICKS, JobEmitter, WATER_THIRSTY_THRESHOLD } from "./job_emitter";
import { JOB_KIND_HARVEST_CROP, JOB_KIND_PLANT_SEED, JOB_KIND_WATER_CROP, JobBoard } from "./jobs";

const WHEAT_BASE_ID = 100;
const TILE_FARMLAND_TILLED = 13;

interface FakeChunks {
  allChunkRecords(): IterableIterator<[string, ChunkRecord]>;
}

function makeChunks(records: Array<[string, ChunkRecord]>): FakeChunks {
  return {
    *allChunkRecords() {
      yield* records;
    },
  };
}

function chunkAt(cx: number, cy: number): [string, ChunkRecord] {
  const data = allocChunkData();
  return [chunkKey(cx, cy), { data, flags: CHUNK_FLAG_DIRTY_RENDER }];
}

describe("JobEmitter", () => {
  test("emits HARVEST for tiles at HARVESTABLE stage", () => {
    const [, record] = chunkAt(0, 0);
    record.data.tileId[tileIndex(2, 3)] = WHEAT_BASE_ID;
    record.data.state[tileIndex(2, 3)] = CROP_STAGE_HARVESTABLE;
    const board = new JobBoard();
    const emitter = new JobEmitter({
      board,
      chunks: makeChunks([[chunkKey(0, 0), record]]),
    });
    expect(emitter.scanAll()).toBe(1);
    const jobs = Array.from(board.all());
    expect(jobs[0]?.kind).toBe(JOB_KIND_HARVEST_CROP);
    expect(jobs[0]?.source).toEqual({ x: 2, y: 3 });
  });

  test("emits WATER_CROP for thirsty growing crops", () => {
    const [, record] = chunkAt(0, 0);
    record.data.tileId[tileIndex(5, 5)] = WHEAT_BASE_ID;
    record.data.state[tileIndex(5, 5)] = 2; // mid-growth
    record.data.metadata[tileIndex(5, 5)] = setWaterLevel(0, WATER_THIRSTY_THRESHOLD);
    const board = new JobBoard();
    const emitter = new JobEmitter({
      board,
      chunks: makeChunks([[chunkKey(0, 0), record]]),
    });
    expect(emitter.scanAll()).toBe(1);
    const jobs = Array.from(board.all());
    expect(jobs[0]?.kind).toBe(JOB_KIND_WATER_CROP);
    expect(jobs[0]?.target).toEqual({ x: 5, y: 5 });
  });

  test("priority increases as water drops", () => {
    const [, recordA] = chunkAt(0, 0);
    recordA.data.tileId[tileIndex(0, 0)] = WHEAT_BASE_ID;
    recordA.data.state[tileIndex(0, 0)] = 2;
    recordA.data.metadata[tileIndex(0, 0)] = setWaterLevel(0, 0); // bone dry
    const [, recordB] = chunkAt(1, 0);
    recordB.data.tileId[tileIndex(0, 0)] = WHEAT_BASE_ID;
    recordB.data.state[tileIndex(0, 0)] = 2;
    recordB.data.metadata[tileIndex(0, 0)] = setWaterLevel(0, 1); // a sip
    const board = new JobBoard();
    const emitter = new JobEmitter({
      board,
      chunks: makeChunks([
        [chunkKey(0, 0), recordA],
        [chunkKey(1, 0), recordB],
      ]),
    });
    emitter.scanAll();
    const jobs = Array.from(board.all());
    const dry = jobs.find((j) => j.target.x === 0);
    const damp = jobs.find((j) => j.target.x === CHUNK_SIZE);
    expect(dry?.priority).toBe(3);
    expect(damp?.priority).toBe(2);
  });

  test("does not emit for wilted crops", () => {
    const [, record] = chunkAt(0, 0);
    record.data.tileId[tileIndex(1, 1)] = WHEAT_BASE_ID;
    record.data.state[tileIndex(1, 1)] = CROP_STATE_WILTED;
    record.data.metadata[tileIndex(1, 1)] = setWaterLevel(0, 0);
    const board = new JobBoard();
    const emitter = new JobEmitter({
      board,
      chunks: makeChunks([[chunkKey(0, 0), record]]),
    });
    expect(emitter.scanAll()).toBe(0);
  });

  test("dedupes against an existing matching job", () => {
    const [, record] = chunkAt(0, 0);
    record.data.tileId[tileIndex(2, 2)] = WHEAT_BASE_ID;
    record.data.state[tileIndex(2, 2)] = CROP_STAGE_HARVESTABLE;
    const board = new JobBoard();
    board.enqueue({
      kind: JOB_KIND_HARVEST_CROP,
      source: { x: 2, y: 2 },
      target: { x: 2, y: 2 },
      priority: 1,
      payload: 0,
    });
    const emitter = new JobEmitter({
      board,
      chunks: makeChunks([[chunkKey(0, 0), record]]),
    });
    expect(emitter.scanAll()).toBe(0);
    expect(board.size()).toBe(1);
  });

  test("respects the period cadence on tick()", () => {
    const [, record] = chunkAt(0, 0);
    record.data.tileId[tileIndex(0, 0)] = WHEAT_BASE_ID;
    record.data.state[tileIndex(0, 0)] = CROP_STAGE_HARVESTABLE;
    const board = new JobBoard();
    const emitter = new JobEmitter({
      board,
      chunks: makeChunks([[chunkKey(0, 0), record]]),
      periodTicks: 5,
    });
    expect(emitter.tick(0)).toBe(1);
    expect(emitter.tick(2)).toBe(0); // too soon
    expect(emitter.tick(5)).toBe(0); // already emitted (dedup) but cadence elapsed → returns 0
    // Now invalidate the dedup by completing the job, then re-tick at next interval.
    for (const j of board.all()) board.complete(j.id);
    expect(emitter.tick(10)).toBe(1);
  });

  test("scans crops across multiple loaded chunks", () => {
    const [, a] = chunkAt(0, 0);
    a.data.tileId[tileIndex(0, 0)] = WHEAT_BASE_ID;
    a.data.state[tileIndex(0, 0)] = CROP_STAGE_HARVESTABLE;
    const [, b] = chunkAt(1, 1);
    b.data.tileId[tileIndex(1, 1)] = WHEAT_BASE_ID;
    b.data.state[tileIndex(1, 1)] = CROP_STAGE_HARVESTABLE;
    const board = new JobBoard();
    const emitter = new JobEmitter({
      board,
      chunks: makeChunks([
        [chunkKey(0, 0), a],
        [chunkKey(1, 1), b],
      ]),
    });
    expect(emitter.scanAll()).toBe(2);
  });

  test("default period matches the documented cadence constant", () => {
    expect(DEFAULT_EMITTER_PERIOD_TICKS).toBe(30);
  });

  test("emits PLANT_SEED for empty tilled tiles when seeds are stocked", () => {
    const [, record] = chunkAt(0, 0);
    record.data.tileId[tileIndex(2, 2)] = TILE_FARMLAND_TILLED;
    record.data.state[tileIndex(2, 2)] = 0;
    const board = new JobBoard();
    const crates = new CrateStore();
    crates.deposit(10, 10, ITEM_IDS.WHEAT_SEED, 5);
    const emitter = new JobEmitter({
      board,
      chunks: makeChunks([[chunkKey(0, 0), record]]),
      crates,
    });
    expect(emitter.scanAll()).toBe(1);
    const jobs = Array.from(board.all());
    expect(jobs[0]?.kind).toBe(JOB_KIND_PLANT_SEED);
    expect(jobs[0]?.source).toEqual({ x: 2, y: 2 });
  });

  test("does not emit PLANT_SEED when no seeds are stocked anywhere", () => {
    const [, record] = chunkAt(0, 0);
    record.data.tileId[tileIndex(2, 2)] = TILE_FARMLAND_TILLED;
    record.data.state[tileIndex(2, 2)] = 0;
    const board = new JobBoard();
    const crates = new CrateStore();
    // Crate exists but holds only produce — should not enable PLANT_SEED.
    crates.deposit(10, 10, ITEM_IDS.WHEAT, 5);
    const emitter = new JobEmitter({
      board,
      chunks: makeChunks([[chunkKey(0, 0), record]]),
      crates,
    });
    expect(emitter.scanAll()).toBe(0);
  });

  test("does not emit PLANT_SEED when crates argument is omitted", () => {
    const [, record] = chunkAt(0, 0);
    record.data.tileId[tileIndex(2, 2)] = TILE_FARMLAND_TILLED;
    record.data.state[tileIndex(2, 2)] = 0;
    const board = new JobBoard();
    const emitter = new JobEmitter({
      board,
      chunks: makeChunks([[chunkKey(0, 0), record]]),
    });
    expect(emitter.scanAll()).toBe(0);
  });

  test("PLANT_SEED dedup: re-scan does not duplicate", () => {
    const [, record] = chunkAt(0, 0);
    record.data.tileId[tileIndex(2, 2)] = TILE_FARMLAND_TILLED;
    record.data.state[tileIndex(2, 2)] = 0;
    const board = new JobBoard();
    const crates = new CrateStore();
    crates.deposit(10, 10, ITEM_IDS.WHEAT_SEED, 5);
    const emitter = new JobEmitter({
      board,
      chunks: makeChunks([[chunkKey(0, 0), record]]),
      crates,
    });
    emitter.scanAll();
    expect(emitter.scanAll()).toBe(0);
    expect(board.size()).toBe(1);
  });
});
