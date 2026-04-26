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

describe("bloomridgeTile (8-band)", () => {
  test("band 0 → deep water regardless of moisture", () => {
    for (let m = 0; m < MOISTURE_BANDS; m++) {
      expect(bloomridgeTile(0, m)).toBe(BLOOMRIDGE_TILES.deepWater);
    }
  });

  test("band 1 → shallow water", () => {
    expect(bloomridgeTile(1, 0)).toBe(BLOOMRIDGE_TILES.shallowWater);
    expect(bloomridgeTile(1, 3)).toBe(BLOOMRIDGE_TILES.shallowWater);
  });

  test("band 2 → beach sand", () => {
    expect(bloomridgeTile(2, 0)).toBe(BLOOMRIDGE_TILES.beachSand);
    expect(bloomridgeTile(2, 3)).toBe(BLOOMRIDGE_TILES.beachSand);
  });

  test("band 3 splits on moisture: low → dry grass, high → rich soil", () => {
    expect(bloomridgeTile(3, 0)).toBe(BLOOMRIDGE_TILES.dryGrass);
    expect(bloomridgeTile(3, 1)).toBe(BLOOMRIDGE_TILES.dryGrass);
    expect(bloomridgeTile(3, 2)).toBe(BLOOMRIDGE_TILES.richSoil);
    expect(bloomridgeTile(3, 3)).toBe(BLOOMRIDGE_TILES.richSoil);
  });

  test("band 4 splits on moisture: dry → grass, anything moister → farmland", () => {
    expect(bloomridgeTile(4, 0)).toBe(BLOOMRIDGE_TILES.dryGrass);
    expect(bloomridgeTile(4, 1)).toBe(BLOOMRIDGE_TILES.farmlandUntilled);
    expect(bloomridgeTile(4, 3)).toBe(BLOOMRIDGE_TILES.farmlandUntilled);
  });

  test("band 5 → dry grass", () => {
    expect(bloomridgeTile(5, 0)).toBe(BLOOMRIDGE_TILES.dryGrass);
    expect(bloomridgeTile(5, 3)).toBe(BLOOMRIDGE_TILES.dryGrass);
  });

  test("band 6 → barren stone", () => {
    expect(bloomridgeTile(6, 0)).toBe(BLOOMRIDGE_TILES.barrenStone);
    expect(bloomridgeTile(6, 3)).toBe(BLOOMRIDGE_TILES.barrenStone);
  });

  test("band 7 → rocky outcrop", () => {
    expect(bloomridgeTile(7, 0)).toBe(BLOOMRIDGE_TILES.rockyOutcrop);
    expect(bloomridgeTile(7, 3)).toBe(BLOOMRIDGE_TILES.rockyOutcrop);
  });
});
