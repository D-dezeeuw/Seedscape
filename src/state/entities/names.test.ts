import { describe, expect, test } from "vitest";
import { namePool, pickName } from "./names";

describe("pickName", () => {
  test("returns a name from the matching pool", () => {
    expect(namePool("villager")).toContain(pickName("villager", 1));
    expect(namePool("animal")).toContain(pickName("animal", 1));
    expect(namePool("pet")).toContain(pickName("pet", 1));
    expect(namePool("mount")).toContain(pickName("mount", 1));
  });

  test("is deterministic for identical seeds", () => {
    expect(pickName("villager", 42)).toBe(pickName("villager", 42));
    expect(pickName("animal", 7)).toBe(pickName("animal", 7));
  });

  test("different seeds usually pick different names (no constant collapse)", () => {
    const names = new Set<string>();
    for (let s = 0; s < 32; s++) names.add(pickName("villager", s));
    expect(names.size).toBeGreaterThan(1);
  });

  test("pools per type are disjoint at first glance (no obvious cross-bleed)", () => {
    const villagers = new Set(namePool("villager"));
    const mounts = new Set(namePool("mount"));
    for (const m of mounts) expect(villagers.has(m)).toBe(false);
  });
});
