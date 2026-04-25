import { describe, expect, test } from "vitest";
import { isBuildingUnlocked, isSeedUnlocked, newUnlocksAtLevel, unlocksForLevel } from "./unlocks";

describe("unlocksForLevel", () => {
  test("level 1 unlocks wheat seed only", () => {
    const set = unlocksForLevel(1);
    expect(set.has("seed.wheat")).toBe(true);
    expect(set.has("building.mill")).toBe(false);
  });

  test("level 5 unlocks wheat, carrot seeds and mill, bakery", () => {
    const set = unlocksForLevel(5);
    expect(set.has("seed.wheat")).toBe(true);
    expect(set.has("seed.carrot")).toBe(true);
    expect(set.has("building.mill")).toBe(true);
    expect(set.has("building.bakery")).toBe(true);
    expect(set.has("seed.corn")).toBe(false);
  });

  test("level 10 unlocks every Phase 4 entry", () => {
    const set = unlocksForLevel(10);
    expect(set.has("seed.corn")).toBe(true);
  });
});

describe("newUnlocksAtLevel", () => {
  test("returns only entries whose required level matches", () => {
    const news = newUnlocksAtLevel(5);
    const ids = news.map((u) => u.id).sort();
    expect(ids).toEqual(["building.bakery", "seed.carrot"]);
  });

  test("empty when nothing unlocks at that level", () => {
    expect(newUnlocksAtLevel(2)).toEqual([]);
  });
});

describe("isBuildingUnlocked / isSeedUnlocked", () => {
  test("mill is unlocked from level 3", () => {
    expect(isBuildingUnlocked(2, 200)).toBe(false);
    expect(isBuildingUnlocked(3, 200)).toBe(true);
  });

  test("carrot seed (id 608) is unlocked from level 5", () => {
    expect(isSeedUnlocked(4, 608)).toBe(false);
    expect(isSeedUnlocked(5, 608)).toBe(true);
  });

  test("unknown ids are never unlocked", () => {
    expect(isBuildingUnlocked(99, 9999)).toBe(false);
    expect(isSeedUnlocked(99, 9999)).toBe(false);
  });
});
