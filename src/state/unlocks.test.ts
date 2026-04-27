import { afterEach, describe, expect, test } from "vitest";
import {
  isBuildingUnlocked,
  isDebugUnlockAll,
  isSeedUnlocked,
  newUnlocksAtLevel,
  setDebugUnlockAll,
  unlocksForLevel,
} from "./unlocks";

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

  test("level 2 unlocks the storage containers", () => {
    const ids = newUnlocksAtLevel(2)
      .map((u) => u.id)
      .sort();
    expect(ids).toEqual(["building.crate", "building.seed_dispenser"]);
  });

  test("empty when nothing unlocks at that level", () => {
    expect(newUnlocksAtLevel(4)).toEqual([]);
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

describe("setDebugUnlockAll override", () => {
  // The flag is module-local; reset between tests so neither order
  // dependency nor a leaked-on test can mask a regression.
  afterEach(() => setDebugUnlockAll(false));

  test("toggle round-trip via isDebugUnlockAll", () => {
    expect(isDebugUnlockAll()).toBe(false);
    setDebugUnlockAll(true);
    expect(isDebugUnlockAll()).toBe(true);
    setDebugUnlockAll(false);
    expect(isDebugUnlockAll()).toBe(false);
  });

  test("when ON, all real unlocks return true regardless of level", () => {
    setDebugUnlockAll(true);
    // Mill normally requires level 3; corn seed requires level 7.
    expect(isBuildingUnlocked(1, 200)).toBe(true);
    expect(isSeedUnlocked(1, 616)).toBe(true);
  });

  test("when ON, unknown ids still return false", () => {
    setDebugUnlockAll(true);
    expect(isBuildingUnlocked(99, 9999)).toBe(false);
    expect(isSeedUnlocked(99, 9999)).toBe(false);
  });

  test("when ON, unlocksForLevel returns every defined unlock id", () => {
    setDebugUnlockAll(true);
    // Level 1 normally has only seed.wheat; with the override all ids land.
    const set = unlocksForLevel(1);
    expect(set.has("seed.wheat")).toBe(true);
    expect(set.has("seed.corn")).toBe(true);
    expect(set.has("building.bakery")).toBe(true);
  });
});
