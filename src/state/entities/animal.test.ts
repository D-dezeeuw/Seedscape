import { describe, expect, test } from "vitest";
import { BuildingBufferStore } from "../../world/farming/building_buffer";
import {
  HUNGER_COST_PER_PRODUCE,
  HUNGER_RESTORE_PER_FEED,
  PRODUCE_HUNGER_THRESHOLD,
} from "../../world/farming/pen_registry";
import { ITEM_IDS } from "../items";
import { Chicken, Cow } from "./animal";
import type { EntityServices, EntityTickContext } from "./entity";
import { HUNGER_MAX } from "./living_entity";

// Animals decay 1 hunger / sim tick (set in Animal constructor).
const HUNGER_DECAY_PER_TICK = 1;

function tickCtx(simTick: number, services: EntityServices): EntityTickContext {
  return {
    time: simTick,
    dt: 1,
    worldSeed: 0,
    isWalkable: () => true,
    simTick,
    services,
  };
}

describe("ProducerAnimal", () => {
  test("hunger decays once per sim tick", () => {
    const buffers = new BuildingBufferStore();
    const c = new Chicken(1, { chunkX: 0, chunkY: 0, localX: 0, localY: 0 }, { x: 0, y: 0 });
    const services: EntityServices = { buildingBuffers: buffers };
    // First tick captures lastSimTick; no decay yet.
    c.tick(tickCtx(1, services));
    expect(c.needs.hunger).toBe(HUNGER_MAX);
    // Second tick is a 1-tick advance.
    c.tick(tickCtx(2, services));
    expect(c.needs.hunger).toBe(HUNGER_MAX - HUNGER_DECAY_PER_TICK);
  });

  test("fed chicken produces an egg after cycleTime ticks", () => {
    const buffers = new BuildingBufferStore();
    const c = new Chicken(1, { chunkX: 0, chunkY: 0, localX: 0, localY: 0 }, { x: 5, y: 5 });
    const services: EntityServices = { buildingBuffers: buffers };
    // Prime lastSimTick.
    c.tick(tickCtx(0, services));
    // Run cycleTime ticks. cycleTime = 60.
    for (let t = 1; t <= 60; t++) c.tick(tickCtx(t, services));
    expect(buffers.outputAt(5, 5, ITEM_IDS.EGG)).toBe(1);
    // Hunger paid the produce cost.
    expect(c.needs.hunger).toBe(HUNGER_MAX - HUNGER_DECAY_PER_TICK * 60 - HUNGER_COST_PER_PRODUCE);
    // Cycle reset.
    expect(c.produceProgress).toBe(0);
  });

  test("starving animal stops producing", () => {
    const buffers = new BuildingBufferStore();
    const c = new Chicken(1, { chunkX: 0, chunkY: 0, localX: 0, localY: 0 }, { x: 0, y: 0 });
    c.needs.hunger = PRODUCE_HUNGER_THRESHOLD - 1;
    const services: EntityServices = { buildingBuffers: buffers };
    c.tick(tickCtx(0, services));
    for (let t = 1; t <= 200; t++) c.tick(tickCtx(t, services));
    expect(buffers.outputAt(0, 0, ITEM_IDS.EGG)).toBe(0);
  });

  test("feed() restores hunger", () => {
    const c = new Cow(1, { chunkX: 0, chunkY: 0, localX: 0, localY: 0 }, { x: 0, y: 0 });
    c.needs.hunger = 50;
    const consumed = c.feed();
    expect(consumed).toBe(1);
    expect(c.needs.hunger).toBe(Math.min(HUNGER_MAX, 50 + HUNGER_RESTORE_PER_FEED));
  });

  test("feed() refuses when full", () => {
    const c = new Cow(1, { chunkX: 0, chunkY: 0, localX: 0, localY: 0 }, { x: 0, y: 0 });
    c.needs.hunger = HUNGER_MAX;
    expect(c.feed()).toBe(0);
    expect(c.needs.hunger).toBe(HUNGER_MAX);
  });

  test("Cow produces milk on its longer cycle", () => {
    const buffers = new BuildingBufferStore();
    const c = new Cow(1, { chunkX: 0, chunkY: 0, localX: 0, localY: 0 }, { x: 3, y: 3 });
    const services: EntityServices = { buildingBuffers: buffers };
    c.tick(tickCtx(0, services));
    for (let t = 1; t <= 120; t++) c.tick(tickCtx(t, services));
    expect(buffers.outputAt(3, 3, ITEM_IDS.MILK)).toBe(1);
  });
});
