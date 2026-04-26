// recordMemory + ring-buffer behaviour. The Phase 7 settler controller
// pushes a MemoryEvent for every action it takes; this test covers the
// helper itself in isolation. The full job-loop integration test in
// villager_jobs.test.ts already verifies that actions actually log
// (via end-to-end harvest/water/plant).

import { describe, expect, test } from "vitest";
import {
  MEMORY_EVENT_TYPES,
  recordMemory,
  SHORT_TERM_CAPACITY,
} from "./living_entity";
import { Villager } from "./villager";

const POS = { chunkX: 0, chunkY: 0, localX: 0.5, localY: 0.5 };
const HOME = { x: 0, y: 0 };

describe("recordMemory", () => {
  test("writes into the head slot and advances the head", () => {
    const v = new Villager(1, POS, "Test", HOME);
    expect(v.shortTermHead).toBe(0);
    recordMemory(v, {
      type: MEMORY_EVENT_TYPES.HARVESTED,
      tick: 5,
      subjectId: 700,
      tileX: 12,
      tileY: 8,
    });
    expect(v.shortTermHead).toBe(1);
    const entry = v.shortTermMemory[0];
    expect(entry?.type).toBe(MEMORY_EVENT_TYPES.HARVESTED);
    expect(entry?.tick).toBe(5);
    expect(entry?.subjectId).toBe(700);
    expect(entry?.tileX).toBe(12);
    expect(entry?.tileY).toBe(8);
  });

  test("ring buffer wraps at SHORT_TERM_CAPACITY", () => {
    const v = new Villager(1, POS, "Test", HOME);
    for (let i = 0; i < SHORT_TERM_CAPACITY + 3; i++) {
      recordMemory(v, { type: MEMORY_EVENT_TYPES.WATERED, tick: i });
    }
    expect(v.shortTermHead).toBe(3);
    // Slot 0 should hold the most recent overwrite (tick = capacity).
    expect(v.shortTermMemory[0]?.tick).toBe(SHORT_TERM_CAPACITY);
    // Slot 4 (untouched in the wrap-around) holds tick=4.
    expect(v.shortTermMemory[4]?.tick).toBe(4);
  });

  test("defaults: subjectId 0, tile 0,0, moodDelta 0, weight 64", () => {
    const v = new Villager(1, POS, "Test", HOME);
    recordMemory(v, { type: MEMORY_EVENT_TYPES.HAULED_WATER, tick: 1 });
    const entry = v.shortTermMemory[0];
    expect(entry?.subjectId).toBe(0);
    expect(entry?.tileX).toBe(0);
    expect(entry?.tileY).toBe(0);
    expect(entry?.moodDelta).toBe(0);
    expect(entry?.weight).toBe(64);
  });

  test("explicit weight + moodDelta override defaults", () => {
    const v = new Villager(1, POS, "Test", HOME);
    recordMemory(v, {
      type: MEMORY_EVENT_TYPES.HARVESTED,
      tick: 1,
      weight: 200,
      moodDelta: 5,
    });
    expect(v.shortTermMemory[0]?.weight).toBe(200);
    expect(v.shortTermMemory[0]?.moodDelta).toBe(5);
  });
});
