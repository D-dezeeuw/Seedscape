import { describe, expect, test } from "vitest";
import {
  BLOOMRIDGE_TILES,
  bloomridgeTile,
  MOISTURE_BANDS,
  quantizeNoise,
  TERRAIN_BANDS,
  TERRAIN_THRESHOLDS,
  terrainBandFromHeight,
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

describe("terrainBandFromHeight", () => {
  test("noise = -1 → deep water band 0", () => {
    expect(terrainBandFromHeight(-1)).toBe(0);
  });

  test("noise = 1 → highest band (rocky outcrop)", () => {
    expect(terrainBandFromHeight(1)).toBe(TERRAIN_THRESHOLDS.length);
  });

  test("each cumulative threshold lands in the next band", () => {
    // A normalized value just under threshold[i] lands in band i; just
    // at-or-above lands in band i+1.
    for (let i = 0; i < TERRAIN_THRESHOLDS.length; i++) {
      const t = TERRAIN_THRESHOLDS[i] as number;
      const justBelow = (t - 0.001) * 2 - 1; // un-normalize
      const justAbove = (t + 0.001) * 2 - 1;
      expect(terrainBandFromHeight(justBelow)).toBe(i);
      expect(terrainBandFromHeight(justAbove)).toBe(i + 1);
    }
  });

  test("output spans all 8 bands (= TERRAIN_BANDS)", () => {
    const seen = new Set<number>();
    for (let v = -1; v <= 1; v += 0.05) seen.add(terrainBandFromHeight(v));
    expect(seen.size).toBe(TERRAIN_BANDS);
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

  test("band 3 splits on moisture: only the driest is dry grass, rest is rich soil", () => {
    expect(bloomridgeTile(3, 0)).toBe(BLOOMRIDGE_TILES.dryGrass);
    expect(bloomridgeTile(3, 1)).toBe(BLOOMRIDGE_TILES.richSoil);
    expect(bloomridgeTile(3, 2)).toBe(BLOOMRIDGE_TILES.richSoil);
    expect(bloomridgeTile(3, 3)).toBe(BLOOMRIDGE_TILES.richSoil);
  });

  test("band 4 is always farmland (moisture-independent)", () => {
    for (let m = 0; m < MOISTURE_BANDS; m++) {
      expect(bloomridgeTile(4, m)).toBe(BLOOMRIDGE_TILES.farmlandUntilled);
    }
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
