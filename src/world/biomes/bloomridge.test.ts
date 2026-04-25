import { describe, expect, test } from "vitest";
import {
  BLOOMRIDGE_TILES,
  bloomridgeTile,
  MOISTURE_BANDS,
  quantizeNoise,
  TERRAIN_BANDS,
} from "./bloomridge";

describe("quantizeNoise", () => {
  test("maps -1 to band 0 and 1 to last band", () => {
    expect(quantizeNoise(-1, TERRAIN_BANDS)).toBe(0);
    expect(quantizeNoise(1, TERRAIN_BANDS)).toBe(TERRAIN_BANDS - 1);
  });

  test("clamps out-of-range inputs", () => {
    expect(quantizeNoise(-2, MOISTURE_BANDS)).toBe(0);
    expect(quantizeNoise(2, MOISTURE_BANDS)).toBe(MOISTURE_BANDS - 1);
  });

  test("zero falls in the middle band", () => {
    const middle = Math.floor(TERRAIN_BANDS / 2);
    expect(quantizeNoise(0, TERRAIN_BANDS)).toBe(middle);
  });
});

describe("bloomridgeTile", () => {
  test("terrain band 0 is always water regardless of moisture", () => {
    for (let m = 0; m < MOISTURE_BANDS; m++) {
      expect(bloomridgeTile(0, m)).toBe(BLOOMRIDGE_TILES.shallowWater);
    }
  });

  test("terrain bands 1-2 + low moisture -> dry grass", () => {
    expect(bloomridgeTile(1, 0)).toBe(BLOOMRIDGE_TILES.dryGrass);
    expect(bloomridgeTile(2, 1)).toBe(BLOOMRIDGE_TILES.dryGrass);
  });

  test("terrain bands 1-2 + high moisture -> rich soil", () => {
    expect(bloomridgeTile(1, 2)).toBe(BLOOMRIDGE_TILES.richSoil);
    expect(bloomridgeTile(2, 3)).toBe(BLOOMRIDGE_TILES.richSoil);
  });

  test("terrain bands 3-5 -> farmland", () => {
    expect(bloomridgeTile(3, 0)).toBe(BLOOMRIDGE_TILES.farmlandUntilled);
    expect(bloomridgeTile(5, 3)).toBe(BLOOMRIDGE_TILES.farmlandUntilled);
  });

  test("terrain bands 6-7 -> rocky outcrop", () => {
    expect(bloomridgeTile(6, 0)).toBe(BLOOMRIDGE_TILES.rockyOutcrop);
    expect(bloomridgeTile(7, 3)).toBe(BLOOMRIDGE_TILES.rockyOutcrop);
  });
});
