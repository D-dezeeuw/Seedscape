import { describe, expect, test } from "vitest";
import { Pet, Mount } from "./animal";
import { FACING_EAST, FACING_NORTH, FACING_SOUTH, FACING_WEST } from "./entity";
import { makeFullNeeds, SHORT_TERM_CAPACITY } from "./living_entity";
import { Villager } from "./villager";

const POS = { chunkX: 0, chunkY: 0, localX: 4, localY: 5 };

describe("Entity coordinate math", () => {
  test("worldX/worldY combine chunk + local", () => {
    const v = new Villager(1, { chunkX: 2, chunkY: 3, localX: 1.5, localY: 0.25 }, "T", { x: 0, y: 0 });
    expect(v.worldX()).toBe(2 * 32 + 1.5);
    expect(v.worldY()).toBe(3 * 32 + 0.25);
  });

  test("worldTileX floors world coords", () => {
    const v = new Villager(1, { chunkX: -1, chunkY: 0, localX: 31.7, localY: 0 }, "T", { x: 0, y: 0 });
    // -32 + 31.7 = -0.3 → floor → -1
    expect(v.worldTileX()).toBe(-1);
  });

  test("setWorldPosition rolls into the right chunk for negative coords", () => {
    const v = new Villager(1, POS, "T", { x: 0, y: 0 });
    v.setWorldPosition(-0.5, 32.5);
    expect(v.chunkX).toBe(-1);
    expect(v.chunkY).toBe(1);
    expect(v.localX).toBeCloseTo(31.5, 5);
    expect(v.localY).toBeCloseTo(0.5, 5);
  });
});

describe("LivingEntity needs/memory slots", () => {
  test("needs initialize full", () => {
    const n = makeFullNeeds();
    expect(n.hunger).toBe(255);
    expect(n.mood).toBe(255);
  });

  test("villager has full short-term ring buffer pre-allocated", () => {
    const v = new Villager(1, POS, "T", { x: 0, y: 0 });
    expect(v.shortTermMemory.length).toBe(SHORT_TERM_CAPACITY);
    expect(v.shortTermMemory[0]?.type).toBe(0);
    expect(v.longTermMemory).toEqual([]);
    expect(v.traits).toBe(0);
  });
});

describe("LivingEntity.moveToward", () => {
  test("stops at the target and returns 0 when overshooting", () => {
    const v = new Villager(1, { chunkX: 0, chunkY: 0, localX: 0, localY: 0 }, "T", { x: 0, y: 0 });
    const remaining = v.moveToward(0.5, 0, 100, 1); // way more than enough
    expect(remaining).toBe(0);
    expect(v.worldX()).toBeCloseTo(0.5, 5);
  });

  test("advances by speed*dt when target is far", () => {
    const v = new Villager(1, { chunkX: 0, chunkY: 0, localX: 0, localY: 0 }, "T", { x: 0, y: 0 });
    const remaining = v.moveToward(10, 0, 4, 1); // 4 tiles in 1 sec
    expect(v.worldX()).toBeCloseTo(4, 5);
    expect(remaining).toBeCloseTo(6, 5);
  });

  test("facing reflects dominant motion axis", () => {
    const v = new Villager(1, { chunkX: 0, chunkY: 0, localX: 0, localY: 0 }, "T", { x: 0, y: 0 });
    v.moveToward(5, 0, 4, 0.1);
    expect(v.facing).toBe(FACING_EAST);
    v.moveToward(-5, 0, 4, 0.1);
    expect(v.facing).toBe(FACING_WEST);
    v.setWorldPosition(0, 0);
    v.moveToward(0, 5, 4, 0.1);
    expect(v.facing).toBe(FACING_SOUTH);
    v.setWorldPosition(0, 0);
    v.moveToward(0, -5, 4, 0.1);
    expect(v.facing).toBe(FACING_NORTH);
  });
});

describe("Animal subclasses", () => {
  test("Pet/Mount carry the right type tag and species", () => {
    const p = new Pet(2, POS, "dog", { x: 4, y: 4 });
    expect(p.type).toBe("pet");
    expect(p.species).toBe("dog");
    expect(p.ownerId).toBeNull();

    const m = new Mount(3, POS, "horse", { x: 4, y: 4 });
    expect(m.type).toBe("mount");
    expect(m.ridden).toBe(false);
  });

  test("animal default tick is a no-op", () => {
    const m = new Mount(3, POS, "horse", { x: 4, y: 4 });
    const before = { ...m };
    m.tick({ time: 1, dt: 1, worldSeed: 42, isWalkable: () => true });
    expect(m.localX).toBe(before.localX);
    expect(m.localY).toBe(before.localY);
  });
});
