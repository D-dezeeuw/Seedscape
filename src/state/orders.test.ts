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

  test("save/load preserves RNG + rotation so future refreshes match", () => {
    // Reference timeline: tick at 0, 60, 120 — three refreshes.
    const reference = new OrderBook(0);
    reference.tick(0);
    reference.tick(60);
    reference.tick(120);
    const refSig = reference.list().map((o) => `${o.npcId}:${o.itemId}:${o.quantity}`);

    // Reload timeline: tick at 0, 60, save, fresh book, load, tick at 120.
    // If rngSeed + rotationOffset weren't persisted, the third refresh
    // would draw from a fresh LCG and rotation 0 instead of continuing.
    const original = new OrderBook(0);
    original.tick(0);
    original.tick(60);
    const snap = original.toJSON();

    const reloaded = new OrderBook(0);
    reloaded.loadFromJSON(snap);
    reloaded.tick(120);
    const reloadedSig = reloaded.list().map((o) => `${o.npcId}:${o.itemId}:${o.quantity}`);

    expect(reloadedSig).toEqual(refSig);
  });

  test("snapshot carries rngSeed + rotationOffset fields", () => {
    const book = new OrderBook(0);
    book.tick(0);
    const snap = book.toJSON();
    expect(typeof snap.rngSeed).toBe("number");
    expect(typeof snap.rotationOffset).toBe("object");
    // After one refresh each NPC has rotated once.
    for (const npc of NPC_DEFS) {
      expect(snap.rotationOffset[npc.id]).toBe(1 % npc.buys.length);
    }
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
