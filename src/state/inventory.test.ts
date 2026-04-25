import { describe, expect, test, vi } from "vitest";
import { Inventory } from "./inventory";
import { ITEM_IDS } from "./items";

const SEED = ITEM_IDS.WHEAT_SEED;
const WHEAT = ITEM_IDS.WHEAT;

describe("Inventory", () => {
  test("starts empty", () => {
    const inv = new Inventory();
    expect(inv.count(SEED)).toBe(0);
    expect(inv.has(SEED)).toBe(false);
  });

  test("add accumulates counts", () => {
    const inv = new Inventory();
    inv.add(SEED, 5);
    inv.add(SEED, 3);
    expect(inv.count(SEED)).toBe(8);
  });

  test("add rejects negative numbers", () => {
    const inv = new Inventory();
    expect(() => inv.add(SEED, -1)).toThrow();
  });

  test("remove succeeds when enough items present", () => {
    const inv = new Inventory();
    inv.add(SEED, 10);
    expect(inv.remove(SEED, 4)).toBe(true);
    expect(inv.count(SEED)).toBe(6);
  });

  test("remove fails and leaves state unchanged when insufficient", () => {
    const inv = new Inventory();
    inv.add(SEED, 2);
    expect(inv.remove(SEED, 5)).toBe(false);
    expect(inv.count(SEED)).toBe(2);
  });

  test("remove deletes the entry when count hits zero", () => {
    const inv = new Inventory();
    inv.add(SEED, 3);
    inv.remove(SEED, 3);
    expect(inv.count(SEED)).toBe(0);
    expect(Array.from(inv.entries())).toEqual([]);
  });

  test("has() with n", () => {
    const inv = new Inventory();
    inv.add(WHEAT, 5);
    expect(inv.has(WHEAT, 5)).toBe(true);
    expect(inv.has(WHEAT, 6)).toBe(false);
  });

  test("subscribe fires on add/remove", () => {
    const inv = new Inventory();
    const listener = vi.fn();
    inv.subscribe(listener);
    inv.add(SEED, 3);
    inv.remove(SEED, 1);
    expect(listener).toHaveBeenCalledWith(SEED, 3);
    expect(listener).toHaveBeenCalledWith(SEED, 2);
  });

  test("unsubscribe stops further notifications", () => {
    const inv = new Inventory();
    const listener = vi.fn();
    const unsubscribe = inv.subscribe(listener);
    inv.add(SEED, 1);
    unsubscribe();
    inv.add(SEED, 1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test("toJSON / loadFromJSON round-trip", () => {
    const inv = new Inventory();
    inv.add(SEED, 100);
    inv.add(WHEAT, 7);
    const snapshot = inv.toJSON();

    const restored = new Inventory();
    restored.loadFromJSON(snapshot);
    expect(restored.count(SEED)).toBe(100);
    expect(restored.count(WHEAT)).toBe(7);
  });

  test("loadFromJSON clears prior state", () => {
    const inv = new Inventory();
    inv.add(SEED, 50);
    inv.loadFromJSON({ [WHEAT]: 3 });
    expect(inv.count(SEED)).toBe(0);
    expect(inv.count(WHEAT)).toBe(3);
  });
});
