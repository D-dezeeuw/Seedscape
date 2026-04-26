// End-to-end logic test for the Phase 6 possession loop. Drives the
// same chain main.ts wires up — PossessionController + InputRouter +
// LivingEntity.moveCardinal + EntityManager.tick(skipId) — without the
// DOM/WebGL/chunk surface so we can assert behavior cheaply.
//
// What this proves:
//   1. Pressing WASD moves the possessed avatar at the configured speed.
//   2. The possessed avatar's wander AI (entity.tick) is suppressed while
//      possessed, so player input isn't fighting the AI.
//   3. Soft-collide separation still runs across the possessed avatar.
//   4. Exiting possession resumes the AI's tick on the now-released entity.

import { describe, expect, test } from "vitest";
import { InputRouter } from "../input/input_router";
import { FACING_EAST } from "./entities/entity";
import { EntityManager } from "./entities/entity_manager";
import { LivingEntity } from "./entities/living_entity";
import { Villager } from "./entities/villager";
import { PossessionController } from "./possession";

const SPEED = 4; // tiles/sec
const ALWAYS_WALKABLE = (): boolean => true;

function makeVillager(id: number, lx: number, ly: number, name = "T"): Villager {
  return new Villager(id, { chunkX: 0, chunkY: 0, localX: lx, localY: ly }, name, {
    x: Math.floor(lx),
    y: Math.floor(ly),
  });
}

// One frame of the main-loop logic, distilled.
function frame(opts: {
  router: InputRouter;
  possession: PossessionController;
  entityManager: EntityManager;
  dt: number;
  time: number;
}): void {
  const move = opts.router.vector();
  const possessed = opts.possession.entity;
  if (opts.possession.isPossessing() && possessed instanceof LivingEntity) {
    possessed.moveCardinal(move.dx, move.dy, SPEED, opts.dt, ALWAYS_WALKABLE);
  }
  opts.entityManager.tick(
    {
      time: opts.time,
      dt: opts.dt,
      worldSeed: 0,
      isWalkable: ALWAYS_WALKABLE,
    },
    possessed?.id ?? null,
  );
}

describe("Phase 6 possession integration", () => {
  test("WASD drives the possessed avatar — and only the possessed avatar", () => {
    const router = new InputRouter();
    const possession = new PossessionController();
    const em = new EntityManager();
    const a = makeVillager(1, 4.5, 4.5, "A");
    const b = makeVillager(2, 20.5, 20.5, "B"); // far away so they don't soft-collide
    em.add(a);
    em.add(b);
    possession.enter(a);

    // Press D — world +X. After dt=0.5 at speed 4 → 2 tiles east.
    router.onKeyDown("d", 100);
    frame({ router, possession, entityManager: em, dt: 0.5, time: 0 });
    expect(a.worldX()).toBeCloseTo(6.5, 5);
    expect(a.facing).toBe(FACING_EAST);
    // B's wander AI still ran (we didn't skip it), but with dt=0.5 and
    // the AI's initial-idle window the position may not actually change.
    // The contract we care about is: A's movement is exactly the input
    // step, no AI noise on top.
    expect(a.worldY()).toBeCloseTo(4.5, 5);
  });

  test("possessed entity's own tick is skipped — no wander noise on top of input", () => {
    const router = new InputRouter();
    const possession = new PossessionController();
    const em = new EntityManager();
    const a = makeVillager(1, 4.5, 4.5);
    em.add(a);

    let aTickCount = 0;
    a.tick = () => {
      aTickCount++;
    };
    possession.enter(a);
    frame({ router, possession, entityManager: em, dt: 0.1, time: 0 });
    frame({ router, possession, entityManager: em, dt: 0.1, time: 0.1 });
    expect(aTickCount).toBe(0);

    // Release possession → AI tick resumes.
    possession.exit();
    frame({ router, possession, entityManager: em, dt: 0.1, time: 0.2 });
    expect(aTickCount).toBe(1);
  });

  test("input drops at exit — releasing mid-press doesn't keep moving the entity", () => {
    const router = new InputRouter();
    const possession = new PossessionController();
    const em = new EntityManager();
    const a = makeVillager(1, 4.5, 4.5);
    a.tick = () => {}; // freeze AI for the assertion
    em.add(a);
    possession.enter(a);

    router.onKeyDown("d", 100);
    frame({ router, possession, entityManager: em, dt: 0.5, time: 0 });
    const xBeforeExit = a.worldX();

    possession.exit();
    // Even if the player never released D before exiting, the world
    // shouldn't keep walking the released entity. main.ts handles this
    // by clearing the router on possession exit, mirrored here:
    router.clear();
    frame({ router, possession, entityManager: em, dt: 0.5, time: 0.5 });
    expect(a.worldX()).toBe(xBeforeExit);
  });

  test("soft-collide still runs across the possessed avatar", () => {
    const router = new InputRouter();
    const possession = new PossessionController();
    const em = new EntityManager();
    const a = makeVillager(1, 4.0, 4.0);
    const b = makeVillager(2, 4.0, 4.0); // overlapping
    a.tick = () => {};
    b.tick = () => {};
    em.add(a);
    em.add(b);
    possession.enter(a);

    frame({ router, possession, entityManager: em, dt: 0.1, time: 0 });
    const dist = Math.hypot(a.worldX() - b.worldX(), a.worldY() - b.worldY());
    expect(dist).toBeGreaterThan(0);
  });
});
