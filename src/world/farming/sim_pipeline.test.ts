import { describe, expect, test } from "vitest";
import { ITEM_IDS } from "../../state/items";
import { allocChunkData, tileIndex } from "../chunk";
import { enqueueJob, setBuildingTile } from "./building_actions";
import { buildingForTile, getQueuedJobs } from "./building_registry";
import { CROP_STAGE_HARVESTABLE } from "./crop_registry";
import {
  allocSimScratch,
  applySimDelta,
  simulateChunkTick,
  WATER_DECAY_INTERVAL,
} from "./sim_pipeline";
import { plantSeed, setWaterLevel, waterTile } from "./tile_actions";

const TILE_FARMLAND_TILLED = 13;
const MILL = buildingForTile(200);
if (!MILL) throw new Error("missing mill in registry");

function plant(c: ReturnType<typeof allocChunkData>, x: number, y: number): void {
  c.tileId[tileIndex(x, y)] = TILE_FARMLAND_TILLED;
  plantSeed(c, x, y, ITEM_IDS.WHEAT_SEED);
  waterTile(c, x, y); // saturate to water=3
}

function placeMill(c: ReturnType<typeof allocChunkData>, x: number, y: number): void {
  if (!MILL) throw new Error("missing mill in registry");
  c.tileId[tileIndex(x, y)] = TILE_FARMLAND_TILLED;
  setBuildingTile(c, x, y, MILL);
}

describe("simulateChunkTick", () => {
  test("returns empty delta when no crops present", () => {
    const c = allocChunkData();
    const scratch = allocSimScratch();
    const delta = simulateChunkTick(c, 1, scratch);
    expect(delta.count).toBe(0);
  });

  test("advances wheat one stage per tick at baseRate=1.0", () => {
    const c = allocChunkData();
    plant(c, 0, 0);
    const scratch = allocSimScratch();
    let stage = 0;
    for (let tick = 1; tick <= 7; tick++) {
      const delta = simulateChunkTick(c, tick, scratch);
      applySimDelta(c, delta);
      expect(c.state[0]).toBeGreaterThan(stage);
      stage = c.state[0] as number;
    }
    expect(c.state[0]).toBe(CROP_STAGE_HARVESTABLE);
  });

  test("stops growing once harvestable", () => {
    const c = allocChunkData();
    plant(c, 0, 0);
    const scratch = allocSimScratch();
    for (let tick = 1; tick <= 20; tick++) {
      applySimDelta(c, simulateChunkTick(c, tick, scratch));
    }
    expect(c.state[0]).toBe(CROP_STAGE_HARVESTABLE);
  });

  test("water decays on the decay interval", () => {
    const c = allocChunkData();
    plant(c, 1, 1);
    // Saturate explicitly so the first decay tick is observable.
    c.metadata[tileIndex(1, 1)] = setWaterLevel(0, 3);
    const scratch = allocSimScratch();
    // Fast-forward through the first decay tick.
    for (let tick = 1; tick <= WATER_DECAY_INTERVAL; tick++) {
      applySimDelta(c, simulateChunkTick(c, tick, scratch));
    }
    // Water should have dropped at least once by now.
    const meta = c.metadata[tileIndex(1, 1)] as number;
    const water = (meta >> 3) & 0b11;
    expect(water).toBeLessThan(3);
  });

  test("growth stalls when water is 0", () => {
    const c = allocChunkData();
    c.tileId[tileIndex(2, 2)] = TILE_FARMLAND_TILLED;
    plantSeed(c, 2, 2, ITEM_IDS.WHEAT_SEED);
    // Drain water to 0.
    c.metadata[tileIndex(2, 2)] = 0;
    const scratch = allocSimScratch();
    for (let tick = 1; tick <= 5; tick++) {
      applySimDelta(c, simulateChunkTick(c, tick, scratch));
    }
    expect(c.state[tileIndex(2, 2)]).toBe(0);
  });

  test("delta only contains tiles that actually changed", () => {
    const c = allocChunkData();
    plant(c, 0, 0);
    plant(c, 5, 5);
    const scratch = allocSimScratch();
    const delta = simulateChunkTick(c, 1, scratch);
    expect(delta.count).toBeLessThanOrEqual(2);
    expect(delta.count).toBeGreaterThan(0);
  });

  test("is deterministic for identical input", () => {
    const a = allocChunkData();
    const b = allocChunkData();
    plant(a, 0, 0);
    plant(b, 0, 0);
    const sa = allocSimScratch();
    const sb = allocSimScratch();
    const da = simulateChunkTick(a, 3, sa);
    const db = simulateChunkTick(b, 3, sb);
    expect(da.count).toBe(db.count);
    expect(Array.from(da.state.slice(0, da.count))).toEqual(
      Array.from(db.state.slice(0, db.count)),
    );
  });

  test("idle building stays idle until queued", () => {
    const c = allocChunkData();
    placeMill(c, 1, 1);
    const scratch = allocSimScratch();
    for (let tick = 1; tick <= 3; tick++) {
      applySimDelta(c, simulateChunkTick(c, tick, scratch));
    }
    expect(c.state[tileIndex(1, 1)]).toBe(0); // still idle
    expect(getQueuedJobs(c.metadata[tileIndex(1, 1)] as number)).toBe(0);
  });

  test("queued building progresses each tick and emits production event on completion", () => {
    const c = allocChunkData();
    placeMill(c, 1, 1);
    enqueueJob(c, 1, 1);
    const scratch = allocSimScratch();
    let lastEvents: ReturnType<typeof simulateChunkTick>["productionEvents"] = [];
    // Run enough ticks to complete one cycle (tick 1 starts, then advances
    // to tick=cycleTime where it emits).
    for (let tick = 1; tick <= MILL.cycleTime + 2; tick++) {
      const delta = simulateChunkTick(c, tick, scratch);
      applySimDelta(c, delta);
      if (delta.productionEvents.length > 0) lastEvents = delta.productionEvents;
    }
    expect(lastEvents.length).toBe(1);
    expect(lastEvents[0]?.itemId).toBe(MILL.outputItem);
    expect(lastEvents[0]?.quantity).toBe(MILL.outputQuantity);
    // Building should be back to idle after the emit tick.
    expect(c.state[tileIndex(1, 1)]).toBe(0);
  });

  test("building does not emit production until cycle completes", () => {
    const c = allocChunkData();
    placeMill(c, 0, 0);
    enqueueJob(c, 0, 0);
    const scratch = allocSimScratch();
    for (let tick = 1; tick < MILL.cycleTime; tick++) {
      const delta = simulateChunkTick(c, tick, scratch);
      applySimDelta(c, delta);
      expect(delta.productionEvents.length).toBe(0);
    }
  });
});
