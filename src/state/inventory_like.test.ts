import { describe, expect, test } from "vitest";
import { Villager } from "./entities/villager";
import { Inventory } from "./inventory";
import { asPlayerInventoryLike, asSettlerInventoryLike } from "./inventory_like";
import { ITEM_IDS } from "./items";

describe("asPlayerInventoryLike", () => {
  test("add/remove/count/entries normalise to InventoryLike shape", () => {
    const inv = new Inventory();
    const view = asPlayerInventoryLike(inv);

    expect(view.add(ITEM_IDS.WHEAT, 5)).toBe(5);
    expect(view.count(ITEM_IDS.WHEAT)).toBe(5);
    // Player remove clamps to available stock and returns count moved.
    expect(view.remove(ITEM_IDS.WHEAT, 8)).toBe(5);
    expect(view.count(ITEM_IDS.WHEAT)).toBe(0);

    view.add(ITEM_IDS.WHEAT, 3);
    view.add(ITEM_IDS.FLOUR, 2);
    const ids = Array.from(view.entries(), ([id]) => id).sort();
    expect(ids).toEqual([ITEM_IDS.WHEAT, ITEM_IDS.FLOUR].sort());
  });

  test("subscribe forwards change events", () => {
    const inv = new Inventory();
    const view = asPlayerInventoryLike(inv);
    let calls = 0;
    const off = view.subscribe?.(() => calls++);
    inv.add(ITEM_IDS.WHEAT, 1);
    expect(calls).toBe(1);
    off?.();
    inv.add(ITEM_IDS.WHEAT, 1);
    expect(calls).toBe(1);
  });
});

describe("asSettlerInventoryLike", () => {
  test("add clamps by carry weight (Phase 7.5)", () => {
    const v = new Villager(1, { chunkX: 0, chunkY: 0, localX: 0.5, localY: 0.5 }, "T", {
      x: 0,
      y: 0,
    });
    const view = asSettlerInventoryLike(v);

    // Wheat is 10/unit, default cap 100 → only 10 fit even though we
    // ask for 50. The adapter must reflect Villager.pickup's clamp.
    expect(view.add(ITEM_IDS.WHEAT, 50)).toBe(10);
    expect(view.count(ITEM_IDS.WHEAT)).toBe(10);
  });

  test("remove clamps to available stock", () => {
    const v = new Villager(1, { chunkX: 0, chunkY: 0, localX: 0.5, localY: 0.5 }, "T", {
      x: 0,
      y: 0,
    });
    const view = asSettlerInventoryLike(v);
    view.add(ITEM_IDS.WHEAT, 4);
    expect(view.remove(ITEM_IDS.WHEAT, 100)).toBe(4);
    expect(view.count(ITEM_IDS.WHEAT)).toBe(0);
  });

  test("entries reflects carriedItems Map", () => {
    const v = new Villager(1, { chunkX: 0, chunkY: 0, localX: 0.5, localY: 0.5 }, "T", {
      x: 0,
      y: 0,
    });
    const view = asSettlerInventoryLike(v);
    view.add(ITEM_IDS.WHEAT_SEED, 3);
    const seen = Array.from(view.entries());
    expect(seen).toEqual([[ITEM_IDS.WHEAT_SEED, 3]]);
  });

  test("no subscribe — settler relies on caller polling", () => {
    const v = new Villager(1, { chunkX: 0, chunkY: 0, localX: 0.5, localY: 0.5 }, "T", {
      x: 0,
      y: 0,
    });
    const view = asSettlerInventoryLike(v);
    expect(view.subscribe).toBeUndefined();
  });
});
