import { describe, expect, test } from "vitest";
import { ITEM_IDS } from "../../state/items";
import { CRATE_CAPACITY, CRATE_TILE_ID, CrateStore } from "./crate";
import { isEntityWalkable } from "../walkability";

describe("crate tile id", () => {
  test("CRATE_TILE_ID lives in the building range and is non-walkable", () => {
    expect(CRATE_TILE_ID).toBeGreaterThanOrEqual(200);
    expect(CRATE_TILE_ID).toBeLessThanOrEqual(299);
    expect(isEntityWalkable(CRATE_TILE_ID)).toBe(false);
  });
});

describe("CrateStore", () => {
  test("empty store reports zero counts", () => {
    const store = new CrateStore();
    expect(store.totalAt(0, 0)).toBe(0);
    expect(store.countAt(0, 0, ITEM_IDS.WHEAT)).toBe(0);
  });

  test("deposit + withdraw round-trip", () => {
    const store = new CrateStore();
    expect(store.deposit(5, 5, ITEM_IDS.WHEAT, 10)).toBe(10);
    expect(store.countAt(5, 5, ITEM_IDS.WHEAT)).toBe(10);
    expect(store.withdraw(5, 5, ITEM_IDS.WHEAT, 4)).toBe(4);
    expect(store.countAt(5, 5, ITEM_IDS.WHEAT)).toBe(6);
  });

  test("deposit clamps to capacity", () => {
    const store = new CrateStore();
    expect(store.deposit(0, 0, ITEM_IDS.WHEAT, CRATE_CAPACITY + 50)).toBe(CRATE_CAPACITY);
    expect(store.deposit(0, 0, ITEM_IDS.CARROT, 10)).toBe(0); // already full
  });

  test("withdraw clamps to available stock", () => {
    const store = new CrateStore();
    store.deposit(1, 1, ITEM_IDS.WHEAT, 5);
    expect(store.withdraw(1, 1, ITEM_IDS.WHEAT, 100)).toBe(5);
    expect(store.totalAt(1, 1)).toBe(0);
  });

  test("multiple item types share capacity", () => {
    const store = new CrateStore();
    store.deposit(0, 0, ITEM_IDS.WHEAT, 100);
    expect(store.deposit(0, 0, ITEM_IDS.CARROT, 200)).toBe(CRATE_CAPACITY - 100);
    expect(store.totalAt(0, 0)).toBe(CRATE_CAPACITY);
  });

  test("withdraw to zero removes the item entry; clearing all empties tile", () => {
    const store = new CrateStore();
    store.deposit(2, 2, ITEM_IDS.WHEAT, 5);
    store.withdraw(2, 2, ITEM_IDS.WHEAT, 5);
    expect(store.countAt(2, 2, ITEM_IDS.WHEAT)).toBe(0);
    expect(Array.from(store.crates()).length).toBe(0);
  });

  test("clearAt drops all contents", () => {
    const store = new CrateStore();
    store.deposit(3, 3, ITEM_IDS.WHEAT, 10);
    store.deposit(3, 3, ITEM_IDS.CARROT, 10);
    store.clearAt(3, 3);
    expect(store.totalAt(3, 3)).toBe(0);
    expect(Array.from(store.crates()).length).toBe(0);
  });

  test("nearestCrateWithRoom finds closest by Manhattan distance", () => {
    const store = new CrateStore();
    store.deposit(0, 0, ITEM_IDS.WHEAT, 1);
    store.deposit(10, 0, ITEM_IDS.WHEAT, 1);
    store.deposit(0, 10, ITEM_IDS.WHEAT, 1);
    expect(store.nearestCrateWithRoom(1, 1)).toEqual({ x: 0, y: 0 });
    expect(store.nearestCrateWithRoom(8, 0)).toEqual({ x: 10, y: 0 });
  });

  test("nearestCrateWithRoom skips full crates", () => {
    const store = new CrateStore();
    // Crate 1 close but full.
    store.deposit(1, 0, ITEM_IDS.WHEAT, CRATE_CAPACITY);
    // Crate 2 farther but with room.
    store.deposit(20, 0, ITEM_IDS.WHEAT, 5);
    expect(store.nearestCrateWithRoom(0, 0)).toEqual({ x: 20, y: 0 });
  });

  test("toJSON / loadFromJSON round-trip", () => {
    const a = new CrateStore();
    a.deposit(5, 7, ITEM_IDS.WHEAT, 10);
    a.deposit(5, 7, ITEM_IDS.CARROT, 5);
    a.deposit(-3, 2, ITEM_IDS.BREAD, 8);
    const snap = a.toJSON();

    const b = new CrateStore();
    b.loadFromJSON(snap);
    expect(b.countAt(5, 7, ITEM_IDS.WHEAT)).toBe(10);
    expect(b.countAt(5, 7, ITEM_IDS.CARROT)).toBe(5);
    expect(b.countAt(-3, 2, ITEM_IDS.BREAD)).toBe(8);
    expect(Array.from(b.crates()).length).toBe(2);
  });
});
