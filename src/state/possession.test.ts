import { describe, expect, test, vi } from "vitest";
import { Villager } from "./entities/villager";
import { entityCenter, PossessionController } from "./possession";

const POS = { chunkX: 0, chunkY: 0, localX: 4, localY: 5 };
const HOME = { x: 0, y: 0 };

describe("PossessionController", () => {
  test("starts in god mode with no entity", () => {
    const p = new PossessionController();
    expect(p.mode).toBe("god");
    expect(p.entity).toBeNull();
    expect(p.isPossessing()).toBe(false);
  });

  test("enter() switches to possess mode and sets the entity", () => {
    const p = new PossessionController();
    const v = new Villager(1, POS, "Aiden", HOME);
    p.enter(v);
    expect(p.mode).toBe("possess");
    expect(p.entity).toBe(v);
    expect(p.isPossessing()).toBe(true);
  });

  test("exit() returns to god mode and clears the entity", () => {
    const p = new PossessionController();
    const v = new Villager(1, POS, "Aiden", HOME);
    p.enter(v);
    p.exit();
    expect(p.mode).toBe("god");
    expect(p.entity).toBeNull();
    expect(p.isPossessing()).toBe(false);
  });

  test("subscribers fire on transitions", () => {
    const p = new PossessionController();
    const cb = vi.fn();
    p.subscribe(cb);
    const v = new Villager(1, POS, "Aiden", HOME);

    p.enter(v);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenLastCalledWith({ mode: "possess", entity: v });

    p.exit();
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenLastCalledWith({ mode: "god", entity: null });
  });

  test("enter() is idempotent on the same entity (no listener spam)", () => {
    const p = new PossessionController();
    const cb = vi.fn();
    p.subscribe(cb);
    const v = new Villager(1, POS, "Aiden", HOME);

    p.enter(v);
    p.enter(v);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  test("enter() switching to a different entity fires once", () => {
    const p = new PossessionController();
    const cb = vi.fn();
    p.subscribe(cb);
    const a = new Villager(1, POS, "A", HOME);
    const b = new Villager(2, POS, "B", HOME);

    p.enter(a);
    p.enter(b);
    expect(cb).toHaveBeenCalledTimes(2);
    expect(p.entity).toBe(b);
  });

  test("exit() in god mode is a no-op (no listener spam)", () => {
    const p = new PossessionController();
    const cb = vi.fn();
    p.subscribe(cb);
    p.exit();
    expect(cb).not.toHaveBeenCalled();
  });

  test("forceReleaseIf only releases when matching entity is possessed", () => {
    const p = new PossessionController();
    const a = new Villager(1, POS, "A", HOME);
    const b = new Villager(2, POS, "B", HOME);
    p.enter(a);

    // Different entity → no-op
    p.forceReleaseIf(b);
    expect(p.entity).toBe(a);

    // Matching → release
    p.forceReleaseIf(a);
    expect(p.entity).toBeNull();
    expect(p.mode).toBe("god");
  });

  test("unsubscribe stops further notifications", () => {
    const p = new PossessionController();
    const cb = vi.fn();
    const off = p.subscribe(cb);
    off();
    p.enter(new Villager(1, POS, "A", HOME));
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("entityCenter", () => {
  test("returns world-space center (entity worldX/Y + 0.5 on both axes)", () => {
    // worldX = chunkX*32 + localX, +0.5 gives the visual center.
    const v = new Villager(
      1,
      { chunkX: 0, chunkY: 0, localX: 4.0, localY: 5.0 },
      "T",
      { x: 0, y: 0 },
    );
    expect(entityCenter(v)).toEqual({ x: 4.5, y: 5.5 });
  });

  test("respects sub-tile localX/localY", () => {
    const v = new Villager(
      1,
      { chunkX: 0, chunkY: 0, localX: 4.25, localY: 5.75 },
      "T",
      { x: 0, y: 0 },
    );
    expect(entityCenter(v)).toEqual({ x: 4.75, y: 6.25 });
  });

  test("respects chunk offsets (negative chunks)", () => {
    const v = new Villager(
      1,
      { chunkX: -1, chunkY: 0, localX: 31.0, localY: 0.0 },
      "T",
      { x: 0, y: 0 },
    );
    // worldX = -32 + 31 = -1, +0.5 = -0.5.
    expect(entityCenter(v)).toEqual({ x: -0.5, y: 0.5 });
  });
});
