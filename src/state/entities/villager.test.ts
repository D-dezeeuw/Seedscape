import { describe, expect, test } from "vitest";
import type { EntityTickContext } from "./entity";
import { VILLAGER_AVAILABLE_ACTIONS } from "./living_entity";
import { Villager } from "./villager";

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
