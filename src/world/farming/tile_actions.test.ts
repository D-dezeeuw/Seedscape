import { describe, expect, test } from "vitest";
import { ITEM_IDS } from "../../state/items";
import { allocChunkData, tileIndex } from "../chunk";
import { CROP_STAGE_HARVESTABLE, CROP_STATE_WILTED } from "./crop_registry";
import {
  getWaterLevel,
  harvestTile,
  isPlantable,
  isTillable,
  plantSeed,
  setWaterLevel,
  tillTile,
  waterTile,
} from "./tile_actions";

const TILE_RICH_SOIL = 11;
const TILE_FARMLAND_TILLED = 13;
const TILE_SHALLOW_WATER = 0;
const WHEAT_BASE = 100;

describe("water level encoding", () => {
  test("getWaterLevel reads bits 3-4", () => {
    expect(getWaterLevel(0)).toBe(0);
    expect(getWaterLevel(0b01000)).toBe(1);
    expect(getWaterLevel(0b11000)).toBe(3);
  });

  test("setWaterLevel writes bits 3-4 and preserves others", () => {
    expect(setWaterLevel(0, 2)).toBe(0b10000);
    expect(setWaterLevel(0b00000111, 2)).toBe(0b00010111);
    // Preserves variant bits 5-7 and fertilizer bits 0-2; only bits 3-4 change.
    expect(setWaterLevel(0b11000111, 0)).toBe(0b11000111);
  });

  test("setWaterLevel clamps to [0, 3]", () => {
    expect(getWaterLevel(setWaterLevel(0, 99))).toBe(3);
    expect(getWaterLevel(setWaterLevel(0, -5))).toBe(0);
  });
});

describe("isTillable / isPlantable", () => {
  test("rich soil is tillable; water is not", () => {
    expect(isTillable(TILE_RICH_SOIL)).toBe(true);
    expect(isTillable(TILE_SHALLOW_WATER)).toBe(false);
  });

  test("only tilled farmland with state 0 is plantable", () => {
    expect(isPlantable(TILE_FARMLAND_TILLED, 0)).toBe(true);
    expect(isPlantable(TILE_FARMLAND_TILLED, 1)).toBe(false);
    expect(isPlantable(TILE_RICH_SOIL, 0)).toBe(false);
  });
});

describe("tillTile", () => {
  test("tills rich soil into farmland tilled", () => {
    const c = allocChunkData();
    c.tileId[0] = TILE_RICH_SOIL;
    expect(tillTile(c, 0, 0).applied).toBe(true);
    expect(c.tileId[0]).toBe(TILE_FARMLAND_TILLED);
  });

  test("rejects untillable tiles", () => {
    const c = allocChunkData();
    c.tileId[0] = TILE_SHALLOW_WATER;
    expect(tillTile(c, 0, 0).applied).toBe(false);
    expect(c.tileId[0]).toBe(TILE_SHALLOW_WATER);
  });
});

describe("plantSeed", () => {
  test("plants wheat on tilled farmland and starts at stage 0 with water 1", () => {
    const c = allocChunkData();
    c.tileId[5] = TILE_FARMLAND_TILLED;
    const result = plantSeed(c, 5, 0, ITEM_IDS.WHEAT_SEED);
    expect(result.applied).toBe(true);
    expect(c.tileId[5]).toBe(WHEAT_BASE);
    expect(c.state[5]).toBe(0);
    expect(getWaterLevel(c.metadata[5] as number)).toBe(1);
  });

  test("rejects planting on non-farmland", () => {
    const c = allocChunkData();
    c.tileId[0] = TILE_RICH_SOIL;
    expect(plantSeed(c, 0, 0, ITEM_IDS.WHEAT_SEED).applied).toBe(false);
  });

  test("rejects planting an unknown seed", () => {
    const c = allocChunkData();
    c.tileId[0] = TILE_FARMLAND_TILLED;
    // 999 isn't in ITEM_IDS but we cast — exercises the cropForSeed null path.
    expect(plantSeed(c, 0, 0, 999 as never).applied).toBe(false);
  });
});

describe("waterTile", () => {
  test("sets water to max on a planted crop", () => {
    const c = allocChunkData();
    c.tileId[0] = WHEAT_BASE;
    c.metadata[0] = 0;
    expect(waterTile(c, 0, 0).applied).toBe(true);
    expect(getWaterLevel(c.metadata[0] as number)).toBe(3);
  });

  test("noop on already-saturated tile", () => {
    const c = allocChunkData();
    c.tileId[0] = WHEAT_BASE;
    c.metadata[0] = setWaterLevel(0, 3);
    expect(waterTile(c, 0, 0).applied).toBe(false);
  });

  test("noop on non-farmable tile", () => {
    const c = allocChunkData();
    c.tileId[0] = TILE_SHALLOW_WATER;
    expect(waterTile(c, 0, 0).applied).toBe(false);
  });
});

describe("harvestTile", () => {
  test("harvests stage-7 crop and returns produce + yield", () => {
    const c = allocChunkData();
    const i = tileIndex(2, 3);
    c.tileId[i] = WHEAT_BASE;
    c.state[i] = CROP_STAGE_HARVESTABLE;
    const result = harvestTile(c, 2, 3);
    expect(result.applied).toBe(true);
    expect(result.yield).toBe(4);
    expect(result.produceItem).toBe(ITEM_IDS.WHEAT);
    expect(c.tileId[i]).toBe(TILE_FARMLAND_TILLED);
    expect(c.state[i]).toBe(0);
  });

  test("rejects harvest on immature crop", () => {
    const c = allocChunkData();
    c.tileId[0] = WHEAT_BASE;
    c.state[0] = 3;
    expect(harvestTile(c, 0, 0).applied).toBe(false);
    expect(c.tileId[0]).toBe(WHEAT_BASE);
  });

  test("clears wilted tile but yields zero", () => {
    const c = allocChunkData();
    c.tileId[0] = WHEAT_BASE;
    c.state[0] = CROP_STATE_WILTED;
    const result = harvestTile(c, 0, 0);
    expect(result.applied).toBe(true);
    expect(result.yield).toBe(0);
    expect(c.tileId[0]).toBe(TILE_FARMLAND_TILLED);
  });
});
