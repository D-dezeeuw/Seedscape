import { describe, expect, test } from "vitest";
import { ITEM_IDS, getFoodValue, isFoodItem } from "../items";
import { EntityManager } from "./entity_manager";
import type { EntityTickContext } from "./entity";
import { HUNGER_HUNGRY_THRESHOLD, HUNGER_MAX } from "./living_entity";
import { Villager } from "./villager";

function tickCtx(simTick: number, time = simTick): EntityTickContext {
  return {
    time,
    dt: 1,
    worldSeed: 0,
    isWalkable: () => true,
    simTick,
  };
}

describe("hunger decay + death", () => {
  test("Villager hunger decays over sim ticks at the configured rate", () => {
    const v = new Villager(1, { chunkX: 0, chunkY: 0, localX: 0.5, localY: 0.5 }, "T", {
      x: 0,
      y: 0,
    });
    // Default decay is 0.5 per sim tick. First call captures baseline.
    v.tick(tickCtx(0));
    expect(v.needs.hunger).toBe(HUNGER_MAX);
    v.tick(tickCtx(10));
    expect(v.needs.hunger).toBe(HUNGER_MAX - 0.5 * 10);
  });

  test("isDead() flips true when hunger reaches 0", () => {
    const v = new Villager(1, { chunkX: 0, chunkY: 0, localX: 0.5, localY: 0.5 }, "T", {
      x: 0,
      y: 0,
    });
    expect(v.isDead()).toBe(false);
    v.needs.hunger = 0;
    expect(v.isDead()).toBe(true);
  });

  test("EntityManager removes dead entities and fires death listener", () => {
    const m = new EntityManager();
    const v = new Villager(1, { chunkX: 0, chunkY: 0, localX: 0.5, localY: 0.5 }, "Hank", {
      x: 0,
      y: 0,
    });
    v.needs.hunger = 0; // pre-death so the next tick removes
    m.add(v);
    let deathSeen: string | null = null;
    m.onDeath((e) => {
      if ("name" in e && typeof (e as Villager).name === "string") {
        deathSeen = (e as Villager).name;
      }
    });
    expect(m.size()).toBe(1);
    m.tick(tickCtx(1));
    expect(m.size()).toBe(0);
    expect(deathSeen).toBe("Hank");
  });
});

describe("food item registry", () => {
  test("carrot, bread, egg, corn are food; wheat, flour, milk are not", () => {
    expect(isFoodItem(ITEM_IDS.CARROT)).toBe(true);
    expect(isFoodItem(ITEM_IDS.BREAD)).toBe(true);
    expect(isFoodItem(ITEM_IDS.EGG)).toBe(true);
    expect(isFoodItem(ITEM_IDS.CORN)).toBe(true);
    expect(isFoodItem(ITEM_IDS.WHEAT)).toBe(false);
    expect(isFoodItem(ITEM_IDS.FLOUR)).toBe(false);
    expect(isFoodItem(ITEM_IDS.MILK)).toBe(false);
  });

  test("foodValue ordering: bread > corn > carrot > egg", () => {
    expect(getFoodValue(ITEM_IDS.BREAD)).toBeGreaterThan(getFoodValue(ITEM_IDS.CORN));
    expect(getFoodValue(ITEM_IDS.CORN)).toBeGreaterThan(getFoodValue(ITEM_IDS.CARROT));
    expect(getFoodValue(ITEM_IDS.CARROT)).toBeGreaterThan(getFoodValue(ITEM_IDS.EGG));
  });
});

describe("HUNGER_HUNGRY_THRESHOLD gate", () => {
  test("threshold sits at 40% of HUNGER_MAX", () => {
    expect(HUNGER_HUNGRY_THRESHOLD).toBeCloseTo(HUNGER_MAX * 0.4, 5);
  });
});
