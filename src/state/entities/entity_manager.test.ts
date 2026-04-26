import { describe, expect, test } from "vitest";
import { EntityManager } from "./entity_manager";
import { Villager } from "./villager";

const POS = { chunkX: 0, chunkY: 0, localX: 0.5, localY: 0.5 };

function makeVillager(id: number, name = "Test", lx = 0.5, ly = 0.5): Villager {
  return new Villager(id, { ...POS, localX: lx, localY: ly }, name, { x: 0, y: 0 });
}

describe("EntityManager", () => {
  test("add/getById/size", () => {
    const m = new EntityManager();
    m.add(makeVillager(1));
    expect(m.size()).toBe(1);
    expect(m.getById(1)?.id).toBe(1);
    expect(m.getById(99)).toBeNull();
  });

  test("rejects duplicate ids", () => {
    const m = new EntityManager();
    m.add(makeVillager(1));
    expect(() => m.add(makeVillager(1))).toThrow(/duplicate/);
  });

  test("remove returns true on hit, false on miss", () => {
    const m = new EntityManager();
    m.add(makeVillager(1));
    expect(m.remove(1)).toBe(true);
    expect(m.remove(1)).toBe(false);
    expect(m.size()).toBe(0);
  });

  test("allocateId returns monotonic ids", () => {
    const m = new EntityManager();
    expect(m.allocateId()).toBe(1);
    expect(m.allocateId()).toBe(2);
  });

  test("add bumps nextId past explicit ids", () => {
    const m = new EntityManager();
    m.add(makeVillager(42));
    expect(m.allocateId()).toBe(43);
  });

  test("setNextIdMin lifts allocator past saved ids", () => {
    const m = new EntityManager();
    m.setNextIdMin(100);
    expect(m.allocateId()).toBe(100);
  });

  test("pickAt returns closest entity within radius", () => {
    const m = new EntityManager();
    m.add(makeVillager(1, "near", 4.5, 4.5));
    m.add(makeVillager(2, "far", 12.5, 12.5));
    // World coords for (4.5, 4.5) within chunk 0 = (4.5, 4.5)
    expect(m.pickAt(4.6, 4.6, 1)?.id).toBe(1);
    expect(m.pickAt(4.6, 4.6, 0.05)).toBeNull();
  });

  test("subscribe fires on add and remove", () => {
    const m = new EntityManager();
    let n = 0;
    const off = m.subscribe(() => n++);
    m.add(makeVillager(1));
    m.remove(1);
    off();
    m.add(makeVillager(2)); // no longer counted
    expect(n).toBe(2);
  });

  test("tick visits every entity", () => {
    const m = new EntityManager();
    let calls = 0;
    const v1 = makeVillager(1);
    const v2 = makeVillager(2);
    // Wrap tick to count.
    const origTick = v1.tick.bind(v1);
    v1.tick = (ctx) => {
      calls++;
      origTick(ctx);
    };
    v2.tick = (ctx) => {
      calls++;
      origTick(ctx);
    };
    m.add(v1);
    m.add(v2);
    m.tick({ time: 0, dt: 0, worldSeed: 1, isWalkable: () => true });
    expect(calls).toBe(2);
  });

  test("soft collision pushes overlapping entities apart", () => {
    const m = new EntityManager();
    const a = makeVillager(1, "A", 4.0, 4.0);
    const b = makeVillager(2, "B", 4.0, 4.0); // exactly overlapping
    m.add(a);
    m.add(b);
    // Stub each entity's tick so the separation pass is the only thing
    // that moves them — keeps the assertion isolated.
    a.tick = () => {};
    b.tick = () => {};
    m.tick({ time: 0, dt: 0, worldSeed: 1, isWalkable: () => true });
    const dist = Math.hypot(a.worldX() - b.worldX(), a.worldY() - b.worldY());
    expect(dist).toBeGreaterThan(0);
  });

  test("entities with softCollide=false skip the separation pass", () => {
    const m = new EntityManager();
    const a = makeVillager(1, "A", 4.0, 4.0);
    const b = makeVillager(2, "B", 4.0, 4.0); // exactly overlapping
    a.softCollide = false;
    m.add(a);
    m.add(b);
    a.tick = () => {};
    b.tick = () => {};
    const before = { ax: a.worldX(), ay: a.worldY(), bx: b.worldX(), by: b.worldY() };
    m.tick({ time: 0, dt: 0, worldSeed: 1, isWalkable: () => true });
    expect(a.worldX()).toBe(before.ax);
    expect(a.worldY()).toBe(before.ay);
    expect(b.worldX()).toBe(before.bx);
    expect(b.worldY()).toBe(before.by);
  });

  test("separation respects isWalkable — no push into blocked tiles", () => {
    const m = new EntityManager();
    const a = makeVillager(1, "A", 4.5, 4.5);
    const b = makeVillager(2, "B", 4.7, 4.5); // nearly overlapping
    m.add(a);
    m.add(b);
    a.tick = () => {};
    b.tick = () => {};
    const before = { ax: a.worldX(), ay: a.worldY(), bx: b.worldX(), by: b.worldY() };
    m.tick({ time: 0, dt: 0, worldSeed: 1, isWalkable: () => false });
    expect(a.worldX()).toBe(before.ax);
    expect(b.worldX()).toBe(before.bx);
  });
});
