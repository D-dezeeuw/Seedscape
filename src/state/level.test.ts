import { describe, expect, test } from "vitest";
import { levelForXp, levelProgress, xpRequiredForLevel, xpThresholdForLevel } from "./level";

describe("xpRequiredForLevel", () => {
  test("level 1 needs 100 xp", () => {
    expect(xpRequiredForLevel(1)).toBe(100);
  });

  test("higher levels need more xp", () => {
    expect(xpRequiredForLevel(5)).toBeGreaterThan(xpRequiredForLevel(2));
  });

  test("non-positive level returns 0", () => {
    expect(xpRequiredForLevel(0)).toBe(0);
    expect(xpRequiredForLevel(-3)).toBe(0);
  });
});

describe("levelForXp", () => {
  test("0 xp is level 1", () => {
    expect(levelForXp(0)).toBe(1);
  });

  test("99 xp is still level 1, 100 xp is level 2", () => {
    expect(levelForXp(99)).toBe(1);
    expect(levelForXp(100)).toBe(2);
  });

  test("xp curve is monotonic", () => {
    let last = 1;
    for (let xp = 0; xp < 50_000; xp += 1000) {
      const lvl = levelForXp(xp);
      expect(lvl).toBeGreaterThanOrEqual(last);
      last = lvl;
    }
  });
});

describe("xpThresholdForLevel", () => {
  test("level 1 starts at 0", () => {
    expect(xpThresholdForLevel(1)).toBe(0);
  });

  test("level 2 starts at xpRequiredForLevel(1)", () => {
    expect(xpThresholdForLevel(2)).toBe(xpRequiredForLevel(1));
  });

  test("levelForXp at the threshold yields the next level", () => {
    const t = xpThresholdForLevel(3);
    expect(levelForXp(t)).toBe(3);
    expect(levelForXp(t - 1)).toBe(2);
  });
});

describe("levelProgress", () => {
  test("at start of level the xpIntoLevel is 0", () => {
    const t = xpThresholdForLevel(3);
    const p = levelProgress(t);
    expect(p.level).toBe(3);
    expect(p.xpIntoLevel).toBe(0);
    expect(p.xpForNextLevel).toBe(xpRequiredForLevel(3));
  });

  test("partway through the level reports the offset", () => {
    const t = xpThresholdForLevel(3);
    const p = levelProgress(t + 50);
    expect(p.level).toBe(3);
    expect(p.xpIntoLevel).toBe(50);
  });
});
