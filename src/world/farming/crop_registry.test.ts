import { describe, expect, test } from "vitest";
import { ITEM_IDS } from "../../state/items";
import {
  CROP_STAGE_HARVESTABLE,
  CROP_STATE_WILTED,
  cropAtlasIndex,
  cropForBaseId,
  cropForSeed,
  cropForTile,
  isCropTile,
} from "./crop_registry";

describe("isCropTile", () => {
  test("100..199 is the crop range", () => {
    expect(isCropTile(100)).toBe(true);
    expect(isCropTile(199)).toBe(true);
    expect(isCropTile(99)).toBe(false);
    expect(isCropTile(200)).toBe(false);
  });
});

describe("crop lookups", () => {
  test("cropForBaseId returns wheat for 100", () => {
    expect(cropForBaseId(100)?.name).toBe("wheat");
  });

  test("cropForTile returns wheat for any wheat stage tile (100-107)", () => {
    for (let stage = 0; stage <= CROP_STAGE_HARVESTABLE; stage++) {
      expect(cropForTile(100 + stage)?.name).toBe("wheat");
    }
  });

  test("cropForSeed maps wheat seed -> wheat crop", () => {
    expect(cropForSeed(ITEM_IDS.WHEAT_SEED)?.name).toBe("wheat");
  });
});

describe("cropAtlasIndex", () => {
  test("returns base + stage", () => {
    expect(cropAtlasIndex(100, 0)).toBe(100);
    expect(cropAtlasIndex(100, 3)).toBe(103);
    expect(cropAtlasIndex(100, CROP_STAGE_HARVESTABLE)).toBe(107);
  });

  test("clamps stage above max to harvestable", () => {
    expect(cropAtlasIndex(100, 200)).toBe(107);
  });

  test("wilted falls back to base id", () => {
    expect(cropAtlasIndex(100, CROP_STATE_WILTED)).toBe(100);
  });
});
