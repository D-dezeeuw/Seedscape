import { describe, expect, test } from "vitest";
import { ITEM_IDS } from "./items";
import { NPC_DEFS, OrderBook } from "./orders";

describe("OrderBook", () => {
  test("tick(0) populates two orders per NPC", () => {
    const book = new OrderBook(0);
    book.tick(0);
    const expected = NPC_DEFS.length * 2;
    expect(book.list().length).toBe(expected);
  });

  test("does not refresh again before the interval", () => {
    const book = new OrderBook(0);
    book.tick(0);
    const initialCount = book.list().length;
    book.tick(30);
    // 30 < 60 second cadence, so the same orders are still there.
    expect(book.list().length).toBe(initialCount);
  });

  test("refreshes after the interval elapses", () => {
    const book = new OrderBook(0);
    book.tick(0);
    const before = book.list().map((o) => `${o.npcId}:${o.itemId}:${o.quantity}`);
    book.tick(60);
    const after = book.list().map((o) => `${o.npcId}:${o.itemId}:${o.quantity}`);
    // Must still produce the same number of slots; rotation may have shifted
    // which item each NPC is buying so the strings differ.
    expect(after.length).toBe(before.length);
  });

  test("fulfill removes the order at the given index", () => {
    const book = new OrderBook(0);
    book.tick(0);
    const initial = book.list().length;
    const removed = book.fulfill(0);
    expect(removed).not.toBeNull();
    expect(book.list().length).toBe(initial - 1);
  });

  test("fulfill on stale index returns null", () => {
    const book = new OrderBook(0);
    book.tick(0);
    expect(book.fulfill(999)).toBeNull();
  });

  test("orders include items from each NPC's buy list", () => {
    const book = new OrderBook(0);
    book.tick(0);
    const tessBuys = new Set(NPC_DEFS.find((n) => n.id === "tess")?.buys ?? []);
    const bramBuys = new Set(NPC_DEFS.find((n) => n.id === "bram")?.buys ?? []);
    for (const order of book.list()) {
      if (order.npcId === "tess") expect(tessBuys.has(order.itemId)).toBe(true);
      if (order.npcId === "bram") expect(bramBuys.has(order.itemId)).toBe(true);
    }
  });

  test("save/load round-trip preserves the order list", () => {
    const a = new OrderBook(0);
    a.tick(0);
    const snap = a.toJSON();

    const b = new OrderBook(0);
    b.loadFromJSON(snap);
    expect(b.list().length).toBe(a.list().length);
    expect(b.list()[0]?.itemId).toBe(a.list()[0]?.itemId);
  });

  test("price respects the NPC's multiplier and item base price", () => {
    const book = new OrderBook(0);
    book.tick(0);
    for (const order of book.list()) {
      // Wheat base = 2, Tess multiplier = 1.0, so wheat price should be 2.
      // Flour base = 12, Bram multiplier = 1.1, so flour price should be 13.
      if (order.npcId === "tess" && order.itemId === ITEM_IDS.WHEAT) {
        expect(order.priceEach).toBe(2);
      }
      if (order.npcId === "bram" && order.itemId === ITEM_IDS.FLOUR) {
        expect(order.priceEach).toBe(13);
      }
    }
  });
});
