// LivingEntity — base for anything with biology (humans, farm animals,
// pets, mounts). Carries the structural slots for needs / memory / mood
// described in docs/18_people_system.md, but no decay or behavior logic
// runs yet. When those systems land in a later phase the entity-creation
// sites don't change.
//
// Today's only behavior: a moveToward helper that updates position and
// facing. Subclasses (Villager etc.) compose this into their tick logic.

import { Entity, type EntityPosition, type Facing, FACING_EAST, FACING_NORTH, FACING_SOUTH, FACING_WEST } from "./entity";

// Six needs per docs/18 — each clamped 0..255. Initialized full so a
// freshly-spawned entity isn't immediately critical.
export interface Needs {
  hunger: number;
  sleep: number;
  cleanliness: number;
  toilet: number;
  social: number;
  mood: number;
}

export function makeFullNeeds(): Needs {
  return { hunger: 255, sleep: 255, cleanliness: 255, toilet: 255, social: 255, mood: 255 };
}

// Short-term ring buffer per docs/18. Capacity 16; head index advances on
// push and wraps. Empty slot sentinel: type === 0.
export const SHORT_TERM_CAPACITY = 16;

export interface MemoryEvent {
  type: number;       // event type enum (0 = empty)
  tick: number;       // when it happened (sim ticks since world start)
  subjectId: number;  // who/what was involved
  moodDelta: number;  // -128..127
  weight: number;     // current weight (0..255), decays over time
}

export interface LongTermEvent {
  type: number;
  firstTick: number;
  lastTick: number;
  subjectId: number;
  weight: number;     // 0..65535 (Uint16)
  flags: number;      // positive/negative/trauma/bond bitmask
}

export abstract class LivingEntity extends Entity {
  needs: Needs;
  // Fixed-size ring buffer; cheaper to keep length stable than to push/pop.
  shortTermMemory: MemoryEvent[];
  shortTermHead: number;
  // Sparse list — capped per-entity at ~32 in the eventual implementation.
  longTermMemory: LongTermEvent[];
  // Packed personality bits. Layout deferred — reserved as Uint8 for now.
  traits: number;

  constructor(id: number, position: EntityPosition, facing: Facing = FACING_SOUTH) {
    super(id, position, facing);
    this.needs = makeFullNeeds();
    this.shortTermMemory = new Array(SHORT_TERM_CAPACITY).fill(null).map(
      () => ({ type: 0, tick: 0, subjectId: 0, moodDelta: 0, weight: 0 }),
    );
    this.shortTermHead = 0;
    this.longTermMemory = [];
    this.traits = 0;
  }

  // Walks the entity from its current position toward (targetWorldX,
  // targetWorldY) at `speed` tiles/sec, advancing by `dt` seconds. Updates
  // facing to match the dominant axis of motion. Returns the remaining
  // distance after the step (0 means arrived this frame).
  moveToward(targetWorldX: number, targetWorldY: number, speed: number, dt: number): number {
    const wx = this.worldX();
    const wy = this.worldY();
    const dx = targetWorldX - wx;
    const dy = targetWorldY - wy;
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-4) return 0;
    const step = Math.min(dist, speed * dt);
    this.setWorldPosition(wx + (dx / dist) * step, wy + (dy / dist) * step);
    this.facing = pickFacing(dx, dy);
    return Math.max(0, dist - step);
  }
}

function pickFacing(dx: number, dy: number): Facing {
  // Dominant axis wins. Y is screen-down-positive in world coords (chunkY
  // increases downward), so dy > 0 means south.
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? FACING_EAST : FACING_WEST;
  }
  return dy > 0 ? FACING_SOUTH : FACING_NORTH;
}
