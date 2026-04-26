import { describe, expect, test } from "vitest";
import { namePool, pickFullName, pickName, surnamePool } from "./names";

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

describe("pickFullName", () => {
  test("returns first + surname combo from the canonical pools", () => {
    const picked = pickFullName(1234);
    const parts = picked.name.split(" ");
    // Surnames may contain a space ("De Jong", "Van den Berg"). Last
    // word is the surname's tail; first word must be from first names.
    const first = parts[0] as string;
    expect(namePool("villager")).toContain(first);
    const surname = parts.slice(1).join(" ");
    expect(surnamePool()).toContain(surname);
  });

  test("returns a gender that is either male or female", () => {
    const picked = pickFullName(1234);
    expect(picked.gender === "male" || picked.gender === "female").toBe(true);
  });

  test("deterministic across both name and gender", () => {
    const a = pickFullName(99);
    const b = pickFullName(99);
    expect(a.name).toBe(b.name);
    expect(a.gender).toBe(b.gender);
  });

  test("yields a mix of male and female across seeds", () => {
    let male = 0;
    let female = 0;
    for (let s = 1; s < 200; s++) {
      const g = pickFullName(s).gender;
      if (g === "male") male++;
      else female++;
    }
    expect(male).toBeGreaterThan(0);
    expect(female).toBeGreaterThan(0);
  });

  test("first and surname draw independently across seeds", () => {
    // Generate a wide swath and verify we see >1 unique surname per
    // first name — proves the streams aren't locked together.
    const byFirst = new Map<string, Set<string>>();
    for (let s = 1; s < 200; s++) {
      const picked = pickFullName(s);
      const parts = picked.name.split(" ");
      const first = parts[0] as string;
      const surname = parts.slice(1).join(" ");
      const set = byFirst.get(first) ?? new Set();
      set.add(surname);
      byFirst.set(first, set);
    }
    let pairsWithMultipleSurnames = 0;
    for (const set of byFirst.values()) {
      if (set.size > 1) pairsWithMultipleSurnames++;
    }
    expect(pairsWithMultipleSurnames).toBeGreaterThan(0);
  });
});
