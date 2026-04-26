// LivingEntity — base for anything with biology (humans, farm animals,
// pets, mounts). Carries the structural slots for needs / memory / mood
// described in docs/18_people_system.md, but no decay or behavior logic
// runs yet. When those systems land in a later phase the entity-creation
// sites don't change.
//
// Today's only behavior: a moveToward helper that updates position and
// facing. Subclasses (Villager etc.) compose this into their tick logic.

import type { Tool } from "../../input/tool";
import {
  Entity,
  type EntityPosition,
  FACING_EAST,
  FACING_NORTH,
  FACING_SOUTH,
  FACING_WEST,
  type Facing,
} from "./entity";

// Action set a possessed entity can run via the action key. The Villager
// default is the full toolset minus "none" (which is just pan / no-op). Other
// living types ship empty until their phase wires them up — possession is
// human-only in MVP per docs/21_vision_and_story.md.
export const VILLAGER_AVAILABLE_ACTIONS: ReadonlyArray<Tool> = [
  "till",
  "plant",
  "water",
  "harvest",
  "build",
  "feed",
  "dismantle",
];

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

// Memory event type codes. 0 reserved as the empty-slot sentinel; real
// events start at 1. Phase 7 logs settler actions; later phases will
// add NPC interactions, witnessed deaths, etc. Stable ids — saves
// reference these by number, so don't renumber existing entries.
export const MEMORY_EVENT_TYPES = {
  EMPTY: 0,
  HARVESTED: 1,
  PLANTED: 2,
  WATERED: 3,
  HAULED_WATER: 4,
  HAULED_SEED: 5,
  DEPOSITED: 6,
} as const;
export type MemoryEventType =
  (typeof MEMORY_EVENT_TYPES)[keyof typeof MEMORY_EVENT_TYPES];

export interface MemoryEvent {
  type: number; // event type enum (0 = empty)
  tick: number; // when it happened (sim ticks since world start)
  subjectId: number; // who/what was involved (item id for action events)
  moodDelta: number; // -128..127
  weight: number; // current weight (0..255), decays over time
  // World tile coords of the action target (HARVESTED, PLANTED, WATERED,
  // DEPOSITED, HAULED_*). Default 0 when the event isn't tied to a tile.
  // Stored alongside subjectId so the person window can show "Watered
  // wheat at (12, 8)" without having to look up the live tile.
  tileX: number;
  tileY: number;
}

export interface LongTermEvent {
  type: number;
  firstTick: number;
  lastTick: number;
  subjectId: number;
  weight: number; // 0..65535 (Uint16)
  flags: number; // positive/negative/trauma/bond bitmask
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
  // True if this entity participates in the soft-collide separation pass.
  // Buildings, parked mounts, etc. set false to act as fixed obstacles.
  // Default true keeps Phase 5 behavior unchanged.
  softCollide: boolean;
  // Game time at which the entity began being unable to advance. Cleared
  // (set to -Infinity) every time the AI confirms forward progress —
  // walking arrives at a waypoint, possession step succeeds, etc.
  // Consumed by entity_manager.resolveSeparation to decay the entity's
  // collision radius once they've been stuck long enough that a knot of
  // settlers might otherwise deadlock. -Infinity is a sentinel for "not
  // currently stuck"; any negative number works but ±Infinity makes the
  // intent obvious in the debugger.
  stuckSince: number;
  // Tools this entity can execute when possessed. Empty = read-only (e.g.
  // a non-possessable creature, or an early animal class).
  availableActions: ReadonlyArray<Tool>;

  constructor(id: number, position: EntityPosition, facing: Facing = FACING_SOUTH) {
    super(id, position, facing);
    this.needs = makeFullNeeds();
    this.shortTermMemory = new Array(SHORT_TERM_CAPACITY)
      .fill(null)
      .map(() => ({
        type: 0,
        tick: 0,
        subjectId: 0,
        moodDelta: 0,
        weight: 0,
        tileX: 0,
        tileY: 0,
      }));
    this.shortTermHead = 0;
    this.longTermMemory = [];
    this.traits = 0;
    this.softCollide = true;
    this.stuckSince = Number.NEGATIVE_INFINITY;
    this.availableActions = [];
  }

  // 4-cardinal step driven by an input vector (typically from
  // InputRouter while possessed). Honors walkability so the player can't
  // walk into water/buildings; updates facing per the input axis. Vector
  // is treated as (-1|0|1) per axis — diagonals collapse to the dominant
  // axis upstream, never here.
  moveCardinal(
    dx: number,
    dy: number,
    speed: number,
    dt: number,
    isWalkable: (worldTileX: number, worldTileY: number) => boolean,
  ): void {
    if (dx === 0 && dy === 0) return;
    // Update facing first so the avatar visibly turns even when the
    // destination tile is blocked.
    if (dx !== 0) this.facing = dx > 0 ? FACING_EAST : FACING_WEST;
    else this.facing = dy > 0 ? FACING_SOUTH : FACING_NORTH;
    const step = speed * dt;
    const nx = this.worldX() + dx * step;
    const ny = this.worldY() + dy * step;
    if (!isWalkable(Math.floor(nx), Math.floor(ny))) return;
    this.setWorldPosition(nx, ny);
  }

  // Walks the entity from its current position toward (targetWorldX,
  // targetWorldY) at `speed` tiles/sec, advancing by `dt` seconds. Updates
  // facing to match the dominant axis of motion. Returns the remaining
  // distance after the step (0 means arrived this frame).
  //
  // When `isWalkable` is supplied, blocks movement onto an unwalkable tile
  // and returns 0 so the AI sees this as "arrived" and idles + picks a
  // new target on the next tick — without this guard the wander path
  // ignores terrain and clips through water/buildings between the entity
  // and a target on the other side. Callers that don't want walkability
  // checks (e.g. tests) can omit the parameter for the legacy behavior.
  moveToward(
    targetWorldX: number,
    targetWorldY: number,
    speed: number,
    dt: number,
    isWalkable?: (worldTileX: number, worldTileY: number) => boolean,
  ): number {
    const wx = this.worldX();
    const wy = this.worldY();
    const dx = targetWorldX - wx;
    const dy = targetWorldY - wy;
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-4) return 0;
    const step = Math.min(dist, speed * dt);
    const nx = wx + (dx / dist) * step;
    const ny = wy + (dy / dist) * step;
    // Update facing first so a blocked entity still visibly turns toward
    // its target — same convention as moveCardinal.
    this.facing = pickFacing(dx, dy);
    if (isWalkable && !isWalkable(Math.floor(nx), Math.floor(ny))) return 0;
    this.setWorldPosition(nx, ny);
    return Math.max(0, dist - step);
  }
}

// Append an event to the entity's short-term memory ring buffer.
// Reuses the slot at `shortTermHead` (no allocation in the hot path)
// and advances the head with wrap-around. Capacity is fixed at
// SHORT_TERM_CAPACITY so older events naturally age out as new ones
// arrive — no separate "weight decays each tick" pass yet, that lives
// in the future people-system phase.
export function recordMemory(
  entity: LivingEntity,
  spec: {
    type: MemoryEventType;
    tick: number;
    subjectId?: number;
    tileX?: number;
    tileY?: number;
    moodDelta?: number;
    weight?: number;
  },
): void {
  const slot = entity.shortTermMemory[entity.shortTermHead];
  if (!slot) return; // shouldn't happen — ring buffer is pre-filled
  slot.type = spec.type;
  slot.tick = spec.tick;
  slot.subjectId = spec.subjectId ?? 0;
  slot.tileX = spec.tileX ?? 0;
  slot.tileY = spec.tileY ?? 0;
  slot.moodDelta = spec.moodDelta ?? 0;
  // Default weight 64 — moderate freshness so readers can sort/filter
  // by it later. Phase 7 doesn't decay these; future work does.
  slot.weight = spec.weight ?? 64;
  entity.shortTermHead = (entity.shortTermHead + 1) % SHORT_TERM_CAPACITY;
}

function pickFacing(dx: number, dy: number): Facing {
  // Dominant axis wins. Y is screen-down-positive in world coords (chunkY
  // increases downward), so dy > 0 means south.
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? FACING_EAST : FACING_WEST;
  }
  return dy > 0 ? FACING_SOUTH : FACING_NORTH;
}
