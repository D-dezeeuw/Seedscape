import { describe, expect, test } from "vitest";
import { ITEM_IDS } from "../../state/items";
import { BuildingBufferStore } from "./building_buffer";

describe("BuildingBufferStore — input", () => {
  test("addInput clamps by cap and reflects in totalInputAt", () => {
    const s = new BuildingBufferStore();
    expect(s.addInput(0, 0, ITEM_IDS.WHEAT, 10, 6)).toBe(6);
    expect(s.addInput(0, 0, ITEM_IDS.WHEAT, 10, 6)).toBe(0);
    expect(s.totalInputAt(0, 0)).toBe(6);
    expect(s.inputAt(0, 0, ITEM_IDS.WHEAT)).toBe(6);
  });

  test("consumeInput drains and prunes empty entries", () => {
    const s = new BuildingBufferStore();
    s.addInput(2, 3, ITEM_IDS.WHEAT, 5, 100);
    expect(s.consumeInput(2, 3, ITEM_IDS.WHEAT, 3)).toBe(3);
    expect(s.totalInputAt(2, 3)).toBe(2);
    expect(s.consumeInput(2, 3, ITEM_IDS.WHEAT, 99)).toBe(2);
    expect(s.totalInputAt(2, 3)).toBe(0);
    // Empty inner is pruned: the tile drops out of `tiles()`.
    expect(Array.from(s.tiles())).toEqual([]);
  });
});

describe("BuildingBufferStore — output", () => {
  test("addOutput clamps and back-pressure reports zero", () => {
    const s = new BuildingBufferStore();
    expect(s.addOutput(1, 1, ITEM_IDS.FLOUR, 4, 6)).toBe(4);
    expect(s.addOutput(1, 1, ITEM_IDS.FLOUR, 5, 6)).toBe(2);
    expect(s.addOutput(1, 1, ITEM_IDS.FLOUR, 1, 6)).toBe(0);
  });

  test("hasAnyOutput / firstOutput report FIFO order", () => {
    const s = new BuildingBufferStore();
    expect(s.hasAnyOutput(0, 0)).toBe(false);
    s.addOutput(0, 0, ITEM_IDS.FLOUR, 2, 100);
    s.addOutput(0, 0, ITEM_IDS.BREAD, 1, 100);
    expect(s.hasAnyOutput(0, 0)).toBe(true);
    const first = s.firstOutput(0, 0);
    expect(first).toEqual({ item: ITEM_IDS.FLOUR, count: 2 });
  });

  test("consumeOutput drains and prunes", () => {
    const s = new BuildingBufferStore();
    s.addOutput(0, 0, ITEM_IDS.FLOUR, 5, 100);
    expect(s.consumeOutput(0, 0, ITEM_IDS.FLOUR, 5)).toBe(5);
    expect(s.hasAnyOutput(0, 0)).toBe(false);
    expect(s.firstOutput(0, 0)).toBeNull();
  });
});

describe("BuildingBufferStore — lifecycle", () => {
  test("clearAt drops both input and output", () => {
    const s = new BuildingBufferStore();
    s.addInput(7, 7, ITEM_IDS.WHEAT, 4, 100);
    s.addOutput(7, 7, ITEM_IDS.FLOUR, 2, 100);
    s.clearAt(7, 7);
    expect(s.totalInputAt(7, 7)).toBe(0);
    expect(s.totalOutputAt(7, 7)).toBe(0);
  });

  test("tiles iterates every distinct tile once even when both buffers exist", () => {
    const s = new BuildingBufferStore();
    s.addInput(0, 0, ITEM_IDS.WHEAT, 1, 100);
    s.addOutput(0, 0, ITEM_IDS.FLOUR, 1, 100);
    s.addInput(5, 5, ITEM_IDS.WHEAT, 1, 100);
    const seen = Array.from(s.tiles())
      .map(({ x, y }) => `${x},${y}`)
      .sort();
    expect(seen).toEqual(["0,0", "5,5"]);
  });
});

describe("BuildingBufferStore — persistence", () => {
  test("toJSON / loadFromJSON round-trip", () => {
    const a = new BuildingBufferStore();
    a.addInput(0, 0, ITEM_IDS.WHEAT, 3, 100);
    a.addOutput(0, 0, ITEM_IDS.FLOUR, 1, 100);
    a.addInput(8, 8, ITEM_IDS.FLOUR, 2, 100);

    const snap = a.toJSON();
    const b = new BuildingBufferStore();
    b.loadFromJSON(snap);

    expect(b.inputAt(0, 0, ITEM_IDS.WHEAT)).toBe(3);
    expect(b.outputAt(0, 0, ITEM_IDS.FLOUR)).toBe(1);
    expect(b.inputAt(8, 8, ITEM_IDS.FLOUR)).toBe(2);
  });

  test("loadFromJSON tolerates a missing snapshot half (forward-compat)", () => {
    const s = new BuildingBufferStore();
    // Load a snapshot that only declares input.
    s.loadFromJSON({ input: { "1,1": { [ITEM_IDS.WHEAT]: 5 } } } as never);
    expect(s.inputAt(1, 1, ITEM_IDS.WHEAT)).toBe(5);
    expect(s.totalOutputAt(1, 1)).toBe(0);
  });
});
