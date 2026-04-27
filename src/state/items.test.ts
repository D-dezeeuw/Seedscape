import { describe, expect, test } from "vitest";
import { getItemDef, getItemWeight, ITEM_DEFS, ITEM_IDS } from "./items";

describe("item registry weight", () => {
  test("every registered item has a non-negative integer weight", () => {
    for (const def of ITEM_DEFS.values()) {
      expect(Number.isInteger(def.weight)).toBe(true);
      expect(def.weight).toBeGreaterThanOrEqual(0);
    }
  });

  test("seeds are lighter than raw produce, raw produce lighter than flour", () => {
    const seed = getItemDef(ITEM_IDS.WHEAT_SEED).weight;
    const wheat = getItemDef(ITEM_IDS.WHEAT).weight;
    const flour = getItemDef(ITEM_IDS.FLOUR).weight;
    expect(seed).toBeLessThan(wheat);
    expect(wheat).toBeLessThan(flour);
  });

  test("getItemWeight returns the def's weight; unknown id defers to 0", () => {
    expect(getItemWeight(ITEM_IDS.WHEAT)).toBe(getItemDef(ITEM_IDS.WHEAT).weight);
    expect(getItemWeight(99999 as never)).toBe(0);
  });
});
