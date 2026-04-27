import { describe, expect, test } from "vitest";
import { allocChunkData, tileIndex } from "../chunk";
import { dismantleBuilding, enqueueJob, isBuildable, setBuildingTile } from "./building_actions";
import { buildingForTile, getQueuedJobs } from "./building_registry";

const TILE_FARMLAND_TILLED = 13;
const TILE_RICH_SOIL = 11;
const TILE_DRY_GRASS = 10;
const TILE_ROCKY_OUTCROP = 20;
const TILE_BARREN_STONE = 22;
const TILE_SHALLOW_WATER = 0;
const TILE_DEEP_WATER = 1;
const TILE_MUDFLAT = 31;
const TILE_DELTAIC_SOIL = 32;
const WHEAT_STAGE_0 = 100;
const MILL = buildingForTile(200);
const BAKERY = buildingForTile(210);
if (!MILL || !BAKERY) throw new Error("missing required building defs in registry");

describe("isBuildable", () => {
  test("any solid ground tile is buildable", () => {
    expect(isBuildable(TILE_FARMLAND_TILLED, 0)).toBe(true);
    expect(isBuildable(TILE_RICH_SOIL, 0)).toBe(true);
    expect(isBuildable(TILE_DRY_GRASS, 0)).toBe(true);
    expect(isBuildable(TILE_ROCKY_OUTCROP, 0)).toBe(true);
  });

  test("water tiles are not buildable", () => {
    expect(isBuildable(TILE_SHALLOW_WATER, 0)).toBe(false);
    expect(isBuildable(TILE_DEEP_WATER, 0)).toBe(false);
  });

  test("soft marsh tiles are not buildable", () => {
    expect(isBuildable(TILE_MUDFLAT, 0)).toBe(false);
    expect(isBuildable(TILE_DELTAIC_SOIL, 0)).toBe(false);
  });

  test("crops and buildings are not buildable (id range guard)", () => {
    expect(isBuildable(WHEAT_STAGE_0, 0)).toBe(false);
    expect(isBuildable(MILL.id, 0)).toBe(false);
  });
});

describe("setBuildingTile", () => {
  test("places a mill on rich soil", () => {
    const c = allocChunkData();
    c.tileId[tileIndex(2, 2)] = TILE_RICH_SOIL;
    expect(setBuildingTile(c, 2, 2, MILL).applied).toBe(true);
    expect(c.tileId[tileIndex(2, 2)]).toBe(MILL.id);
    expect(c.state[tileIndex(2, 2)]).toBe(0);
    expect(getQueuedJobs(c.metadata[tileIndex(2, 2)] as number)).toBe(0);
  });

  test("places a mill on tilled farmland", () => {
    const c = allocChunkData();
    c.tileId[tileIndex(2, 2)] = TILE_FARMLAND_TILLED;
    expect(setBuildingTile(c, 2, 2, MILL).applied).toBe(true);
    expect(c.tileId[tileIndex(2, 2)]).toBe(MILL.id);
  });

  test("rejects placement on water", () => {
    const c = allocChunkData();
    c.tileId[0] = TILE_SHALLOW_WATER;
    expect(setBuildingTile(c, 0, 0, MILL).applied).toBe(false);
  });

  test("rejects placement on existing crop", () => {
    const c = allocChunkData();
    c.tileId[0] = WHEAT_STAGE_0;
    expect(setBuildingTile(c, 0, 0, MILL).applied).toBe(false);
  });
});

describe("enqueueJob", () => {
  test("increments the queue counter on a placed building", () => {
    const c = allocChunkData();
    c.tileId[0] = TILE_FARMLAND_TILLED;
    setBuildingTile(c, 0, 0, MILL);
    expect(enqueueJob(c, 0, 0).applied).toBe(true);
    expect(getQueuedJobs(c.metadata[0] as number)).toBe(1);
  });

  test("returns false when queue is full", () => {
    const c = allocChunkData();
    c.tileId[0] = TILE_FARMLAND_TILLED;
    setBuildingTile(c, 0, 0, MILL);
    for (let n = 0; n < MILL.queueSize; n++) enqueueJob(c, 0, 0);
    expect(enqueueJob(c, 0, 0).applied).toBe(false);
    expect(getQueuedJobs(c.metadata[0] as number)).toBe(MILL.queueSize);
  });

  test("rejects on a non-building tile", () => {
    const c = allocChunkData();
    c.tileId[0] = TILE_FARMLAND_TILLED;
    expect(enqueueJob(c, 0, 0).applied).toBe(false);
  });
});

describe("dismantleBuilding", () => {
  test("clears a placed building back to barren stone", () => {
    const c = allocChunkData();
    c.tileId[0] = TILE_FARMLAND_TILLED;
    setBuildingTile(c, 0, 0, MILL);
    expect(dismantleBuilding(c, 0, 0).applied).toBe(true);
    expect(c.tileId[0]).toBe(TILE_BARREN_STONE);
    expect(c.state[0]).toBe(0);
  });

  test("noop on a non-building tile", () => {
    const c = allocChunkData();
    c.tileId[0] = TILE_FARMLAND_TILLED;
    expect(dismantleBuilding(c, 0, 0).applied).toBe(false);
  });
});
