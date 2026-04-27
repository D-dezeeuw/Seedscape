import { describe, expect, test } from "vitest";
import { ITEM_IDS } from "../items";
import type { EntityTickContext } from "./entity";
import { MAX_STACK_SIZE, VILLAGER_AVAILABLE_ACTIONS } from "./living_entity";
import { Villager } from "./villager";

function makeVillager(): Villager {
  return new Villager(1, { chunkX: 0, chunkY: 0, localX: 0.5, localY: 0.5 }, "T", {
    x: 0,
    y: 0,
  });
}

const ALWAYS_WALKABLE: EntityTickContext["isWalkable"] = () => true;

function tickN(v: Villager, ticks: number, dt: number, worldSeed: number): void {
  for (let i = 0; i < ticks; i++) {
    v.tick({ time: i * dt, dt, worldSeed, isWalkable: ALWAYS_WALKABLE });
  }
}

describe("Villager capabilities", () => {
  test("softCollide defaults to true", () => {
    const v = new Villager(1, { chunkX: 0, chunkY: 0, localX: 0.5, localY: 0.5 }, "T", {
      x: 0,
      y: 0,
    });
    expect(v.softCollide).toBe(true);
  });

  test("availableActions matches VILLAGER_AVAILABLE_ACTIONS (full toolset minus pan)", () => {
    const v = new Villager(1, { chunkX: 0, chunkY: 0, localX: 0.5, localY: 0.5 }, "T", {
      x: 0,
      y: 0,
    });
    expect(v.availableActions).toEqual(VILLAGER_AVAILABLE_ACTIONS);
    expect(v.availableActions).not.toContain("none");
  });
});

describe("Villager weighted carry", () => {
  test("pickup respects per-instance weight cap", () => {
    const v = makeVillager();
    // wheat = 10/unit, cap = 100 → 10 fits.
    const taken = v.pickup(ITEM_IDS.WHEAT, 50);
    expect(taken).toBe(10);
    expect(v.carriedItems.get(ITEM_IDS.WHEAT)).toBe(10);
    expect(v.carriedWeight()).toBe(100);
  });

  test("pickup of heavier items takes fewer units", () => {
    const v = makeVillager();
    // flour = 25/unit, cap = 100 → 4 fits.
    const taken = v.pickup(ITEM_IDS.FLOUR, 10);
    expect(taken).toBe(4);
    expect(v.carriedWeight()).toBe(100);
  });

  test("pickup is bounded by per-stack ceiling, not just weight", () => {
    const v = makeVillager();
    v.maxCarryWeight = 1_000_000; // make weight non-binding
    // Seeds are 1/unit so a 200-wheat-seed pickup would fit by weight,
    // but the per-stack 99 cap clamps it.
    const taken = v.pickup(ITEM_IDS.WHEAT_SEED, 200);
    expect(taken).toBe(MAX_STACK_SIZE);
  });

  test("isOverweight crosses at 70% by default", () => {
    const v = makeVillager();
    v.pickup(ITEM_IDS.WHEAT, 6); // 60 weight, below 70
    expect(v.isOverweight()).toBe(false);
    v.pickup(ITEM_IDS.WHEAT, 1); // 70 weight, at threshold
    expect(v.isOverweight()).toBe(true);
  });

  test("drop reverses pickup and prunes empty stacks", () => {
    const v = makeVillager();
    v.pickup(ITEM_IDS.WHEAT, 3);
    expect(v.drop(ITEM_IDS.WHEAT, 3)).toBe(3);
    expect(v.carriedItems.has(ITEM_IDS.WHEAT)).toBe(false);
  });
});

describe("Villager wander", () => {
  test("two villagers with the same id + seed walk identical paths", () => {
    const a = new Villager(1, { chunkX: 0, chunkY: 0, localX: 0.5, localY: 0.5 }, "T", {
      x: 0,
      y: 0,
    });
    const b = new Villager(1, { chunkX: 0, chunkY: 0, localX: 0.5, localY: 0.5 }, "T", {
      x: 0,
      y: 0,
    });
    tickN(a, 60, 1 / 30, 12345);
    tickN(b, 60, 1 / 30, 12345);
    expect(a.worldX()).toBeCloseTo(b.worldX(), 5);
    expect(a.worldY()).toBeCloseTo(b.worldY(), 5);
    expect(a.facing).toBe(b.facing);
  });

  test("different ids diverge under the same seed", () => {
    // 600 ticks at dt=1/30 = 20 sec — enough time to clear initial idle
    // (2-5s) and walk to a wander target; different ids → different seed
    // → different target → divergent positions.
    const a = new Villager(1, { chunkX: 0, chunkY: 0, localX: 0.5, localY: 0.5 }, "A", {
      x: 0,
      y: 0,
    });
    const b = new Villager(2, { chunkX: 0, chunkY: 0, localX: 0.5, localY: 0.5 }, "B", {
      x: 0,
      y: 0,
    });
    tickN(a, 600, 1 / 30, 999);
    tickN(b, 600, 1 / 30, 999);
    const dx = a.worldX() - b.worldX();
    const dy = a.worldY() - b.worldY();
    expect(Math.hypot(dx, dy)).toBeGreaterThan(0.01);
  });

  test("never strays past wander radius from home", () => {
    const v = new Villager(1, { chunkX: 0, chunkY: 0, localX: 4.5, localY: 4.5 }, "T", {
      x: 4,
      y: 4,
    });
    let maxDist = 0;
    for (let i = 0; i < 600; i++) {
      v.tick({ time: i * (1 / 30), dt: 1 / 30, worldSeed: 7, isWalkable: ALWAYS_WALKABLE });
      const d = Math.hypot(v.worldX() - 4.5, v.worldY() - 4.5);
      if (d > maxDist) maxDist = d;
    }
    // Wander radius is 6 plus half-tile target slack — well under 8.
    expect(maxDist).toBeLessThan(8);
  });

  test("respects isWalkable — falls back to home center when surroundings are blocked", () => {
    const v = new Villager(1, { chunkX: 0, chunkY: 0, localX: 4.5, localY: 4.5 }, "T", {
      x: 4,
      y: 4,
    });
    // Ride the first idle out so the AI must pick a target.
    v.tick({ time: 0, dt: 1 / 30, worldSeed: 1, isWalkable: () => false });
    const t = v.getWanderTarget();
    expect(t.x).toBeCloseTo(4.5, 5);
    expect(t.y).toBeCloseTo(4.5, 5);
  });
});
