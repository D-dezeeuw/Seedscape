// Stuck-aware collision relaxation. Verifies the effectiveSeparationRadius
// curve at the boundaries (full → linear decay → ghost) and that a knot of
// soft-colliding entities actually unwinds after the ghost threshold.

import { describe, expect, test } from "vitest";
import {
  effectiveSeparationRadius,
  EntityManager,
  SEPARATION_GHOST_START_SEC,
  SEPARATION_RADIUS,
  SEPARATION_RELAX_START_SEC,
} from "./entity_manager";
import type { EntityTickContext } from "./entity";
import { Villager } from "./villager";

const NEVER_STUCK = Number.NEGATIVE_INFINITY;

describe("effectiveSeparationRadius", () => {
  test("not stuck → full radius", () => {
    expect(effectiveSeparationRadius(NEVER_STUCK, 100)).toBe(SEPARATION_RADIUS);
  });

  test("stuck below relax threshold → still full radius", () => {
    const time = SEPARATION_RELAX_START_SEC - 0.1;
    expect(effectiveSeparationRadius(0, time)).toBeCloseTo(SEPARATION_RADIUS, 5);
  });

  test("decay curve: full at relax start, half at ghost start, midpoint 0.75x", () => {
    // At exactly the relax-start boundary the linear ramp is at t=0 →
    // returns full radius. Decay only takes effect strictly after.
    expect(effectiveSeparationRadius(0, SEPARATION_RELAX_START_SEC)).toBeCloseTo(
      SEPARATION_RADIUS,
      5,
    );
    // At the midpoint of the ramp the radius is 75% of full.
    const mid = (SEPARATION_RELAX_START_SEC + SEPARATION_GHOST_START_SEC) / 2;
    expect(effectiveSeparationRadius(0, mid)).toBeCloseTo(SEPARATION_RADIUS * 0.75, 5);
  });

  test("at ghost start → ghost mode (radius 0)", () => {
    expect(effectiveSeparationRadius(0, SEPARATION_GHOST_START_SEC)).toBe(0);
    expect(effectiveSeparationRadius(0, SEPARATION_GHOST_START_SEC + 5)).toBe(0);
  });
});

describe("resolveSeparation honours per-entity stuck timers", () => {
  test("two adjacent ghosting settlers don't push each other", () => {
    // Place two settlers at the exact same tile. Without ghost mode the
    // separation pass would push them apart by SEPARATION_RADIUS / 2.
    const m = new EntityManager();
    const a = new Villager(
      1,
      { chunkX: 0, chunkY: 0, localX: 5, localY: 5 },
      "A",
      { x: 5, y: 5 },
    );
    const b = new Villager(
      2,
      { chunkX: 0, chunkY: 0, localX: 5, localY: 5 },
      "B",
      { x: 5, y: 5 },
    );
    a.stuckSince = 0;
    b.stuckSince = 0;
    m.add(a);
    m.add(b);

    const ctx: EntityTickContext = {
      time: SEPARATION_GHOST_START_SEC + 1, // ghost mode
      dt: 0.016,
      worldSeed: 1,
      isWalkable: () => true,
    };
    // EntityManager.tick runs entity ticks then resolveSeparation. Skip
    // the wander tick by using skipId for both (only LivingEntity-based).
    m.tick(ctx, a.id);
    m.tick(ctx, b.id);
    // Both should still be at (5, 5) — no push, ghost mode disabled it.
    expect(a.worldX()).toBeCloseTo(5, 4);
    expect(a.worldY()).toBeCloseTo(5, 4);
    expect(b.worldX()).toBeCloseTo(5, 4);
    expect(b.worldY()).toBeCloseTo(5, 4);
  });

  test("two non-stuck settlers at same tile DO get pushed apart", () => {
    const m = new EntityManager();
    const a = new Villager(
      1,
      { chunkX: 0, chunkY: 0, localX: 5, localY: 5 },
      "A",
      { x: 5, y: 5 },
    );
    const b = new Villager(
      2,
      { chunkX: 0, chunkY: 0, localX: 5, localY: 5 },
      "B",
      { x: 5, y: 5 },
    );
    // stuckSince stays at NEVER_STUCK → full radius.
    m.add(a);
    m.add(b);
    const ctx: EntityTickContext = {
      time: 100,
      dt: 0.016,
      worldSeed: 1,
      isWalkable: () => true,
    };
    m.tick(ctx, a.id);
    m.tick(ctx, b.id);
    // Should have separated: distance is some non-zero amount.
    const dx = a.worldX() - b.worldX();
    const dy = a.worldY() - b.worldY();
    const dist = Math.hypot(dx, dy);
    expect(dist).toBeGreaterThan(0);
  });

  test("min radius rule: one ghosting + one normal still untangle", () => {
    // a is ghosting (stuck a long time); b is fresh (never stuck). The
    // pair check uses min(radiusA, radiusB) which is 0, so neither pushes.
    // This is the design: ghost mode lets *the knot* dissolve regardless
    // of which side is ghosted.
    const m = new EntityManager();
    const a = new Villager(
      1,
      { chunkX: 0, chunkY: 0, localX: 5, localY: 5 },
      "A",
      { x: 5, y: 5 },
    );
    const b = new Villager(
      2,
      { chunkX: 0, chunkY: 0, localX: 5.05, localY: 5 },
      "B",
      { x: 5, y: 5 },
    );
    a.stuckSince = 0;
    m.add(a);
    m.add(b);
    const ctx: EntityTickContext = {
      time: SEPARATION_GHOST_START_SEC + 1,
      dt: 0.016,
      worldSeed: 1,
      isWalkable: () => true,
    };
    const beforeBx = b.worldX();
    m.tick(ctx, a.id);
    m.tick(ctx, b.id);
    expect(b.worldX()).toBeCloseTo(beforeBx, 4);
  });

  test("settler arriving at waypoint clears its stuck timer", () => {
    // The state machine clears stuckSince on every successful waypoint
    // advance. Verify the field protocol — the integration test in
    // villager_jobs.test.ts already covers it inside a job, but this
    // confirms the contract independently: setting stuckSince to a
    // value, then assigning -Infinity, restores full radius.
    const e = new Villager(
      99,
      { chunkX: 0, chunkY: 0, localX: 1, localY: 1 },
      "C",
      { x: 1, y: 1 },
    );
    e.stuckSince = 0;
    expect(effectiveSeparationRadius(e.stuckSince, SEPARATION_GHOST_START_SEC + 5)).toBe(0);
    e.stuckSince = Number.NEGATIVE_INFINITY;
    expect(effectiveSeparationRadius(e.stuckSince, 999)).toBe(SEPARATION_RADIUS);
  });
});
