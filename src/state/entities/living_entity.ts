// LivingEntity — base for anything with biology (humans, farm animals,
// pets, mounts). Carries the structural slots for needs / memory / mood
// described in docs/18_people_system.md, but no decay or behavior logic
// runs yet. When those systems land in a later phase the entity-creation
// sites don't change.
//
// Today's only behavior: a moveToward helper that updates position and
// facing. Subclasses (Villager etc.) compose this into their tick logic.

import type { Tool } from "../../input/tool";
import { getItemWeight, type ItemId } from "../items";
import {
  Entity,
  type EntityPosition,
  type EntityTickContext,
  FACING_EAST,
  FACING_NORTH,
  FACING_SOUTH,
  FACING_WEST,
  type Facing,
} from "./entity";

// Per-stack ceiling shared by every carrying entity. Picked at 99 so a
// single ItemId never overflows a Uint8 slot when we eventually pack
// inventories into typed arrays. Stacks above this are split or refused
// at pickup time. Per-entity carry caps live on LivingEntity so each
// subclass tunes its own weight budget — see Villager.
export const MAX_STACK_SIZE = 99;

// Max value for any need byte (hunger, sleep, etc.). Universal because
// every LivingEntity uses the same 0..255 scale per docs/18.
export const HUNGER_MAX = 255;
// Below this fraction of HUNGER_MAX a settler injects an "eat" task at
// the next idle. 0.4 = ~40% leaves room to finish the current job
// without thrashing on the threshold edge.
export const HUNGER_HUNGRY_THRESHOLD = HUNGER_MAX * 0.4;

// Sensible default for a carrying entity: no carrying. Subclasses opt
// in by setting maxCarryWeight in their constructor. This keeps any
// future LivingEntity subclass that hasn't thought about inventory
// from accidentally hauling cargo.
const DEFAULT_MAX_CARRY_WEIGHT = 0;

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
  // Phase 8 — settler-driven production hauling.
  FED_BUILDING: 7, // dropped input items into a building's input buffer
  HAULED_OUTPUT: 8, // pulled items from a building's output buffer
} as const;
export type MemoryEventType = (typeof MEMORY_EVENT_TYPES)[keyof typeof MEMORY_EVENT_TYPES];

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
  // Carry-cap fields. Per-instance so a child class (or even a single
  // entity, e.g. an upgraded settler with a cart) can override its
  // limits without inheriting a global. Stack size has a hard ceiling
  // at MAX_STACK_SIZE since the eventual typed-array inventory can't
  // store > 255 in a Uint8 and 99 keeps the math human-readable in
  // tooltips. Weight is in deci-units (×10) — see ITEM_DEFS.weight.
  maxCarryWeight: number;
  maxStackSize: number;
  // Items the entity is carrying. Lives on the base class because
  // settlers, animals (saddle-bags later), and mounts will all share
  // the same shape. Empty Map by default; subclasses that don't carry
  // simply leave maxCarryWeight at 0 so pickup() refuses everything.
  readonly carriedItems = new Map<ItemId, number>();

  // Decay rate for needs.hunger in hunger-units per sim tick.
  // Float-valued so subclasses can pick a tempo without quantising to
  // integer ticks. Default 0.5 = ~10 minutes from full to dead at 1 TPS,
  // tuned for a settler that can survive a moderate workday but can't
  // ignore food entirely. ProducerAnimal overrides to 1.0 so animals
  // eat more frequently. Hunger value itself lives on the shared
  // `needs` struct (see docs/18) — settlers read/write needs.hunger.
  hungerDecayPerTick: number = 0.5;
  // Last sim tick the hunger / produce-cycle pipeline processed. Lifted
  // here from ProducerAnimal so tickHunger and any future per-tick
  // need pipeline reuse it. Null = "first tick — establish baseline".
  protected lastHungerTick: number | null = null;

  // Per-entity "can I stand on this tile?" check. The default delegates
  // to the global `isEntityWalkable` rule via ctx.isWalkable — same as
  // pre-Phase-9.2 behaviour, so settlers keep the existing constraints.
  // Subclasses (Animals constrained to a species-specific pen, future
  // amphibians that walk in shallow water) override to widen or
  // narrow their reachable set without altering the global rule.
  //
  // Used by entity_manager's separation pass + by entities' own
  // moveToward closures so wander, possession, and soft-collide all
  // share one source of truth per entity.
  canEnter(worldTileX: number, worldTileY: number, ctx: EntityTickContext): boolean {
    return ctx.isWalkable(worldTileX, worldTileY);
  }

  // Idle-wander state, shared by every LivingEntity. The behaviour is
  // identical for villagers and animals — pick a random walkable
  // (= canEnter) point within wanderRadius of wanderAnchor, walk
  // there, pause, repeat. What differs is the anchor (home tile vs
  // pen tile) and the per-step walkability rule (chickens can't
  // leave their pen). Subclasses override `wanderAnchor()` and the
  // tuning fields below; `canEnter()` handles the constraint.
  protected wanderRadius = 6;
  protected wanderSpeed = 4; // tiles/sec
  protected wanderIdleMin = 2;
  protected wanderIdleMax = 5;
  protected wanderArriveEpsilon = 0.1;
  private wanderTargetX: number | null = null;
  private wanderTargetY: number | null = null;
  private wanderPauseUntil = 0;
  // Per-entity LCG state for wander RNG. Seeded from id at
  // construction so two entities with the same id wander identically
  // (preserves the deterministic-replay property the old Villager
  // wander relied on, without dragging worldSeed + ctx.time into
  // every pick).
  private wanderSeed: number;

  // World-space (sub-tile) anchor the wander loops around. Default is
  // the entity's spawn position; Villager points it at home tile
  // centre, ProducerAnimal at pen tile centre.
  protected wanderAnchor(): { x: number; y: number } {
    return { x: this.worldX(), y: this.worldY() };
  }

  // Drive one frame of idle wander. Subclasses call this when they have
  // nothing else to do (no job claim, no driven movement). Returns
  // nothing — the entity may move or stay still depending on pause /
  // canEnter results. Walkability for the step uses canEnter so each
  // subclass's terrain rule is honoured.
  protected tickWander(ctx: EntityTickContext): void {
    if (ctx.time < this.wanderPauseUntil) return;

    if (this.wanderTargetX === null || this.wanderTargetY === null) {
      this.pickWanderTarget(ctx);
    }
    const tx = this.wanderTargetX;
    const ty = this.wanderTargetY;
    if (tx === null || ty === null) {
      // No reachable target — pause briefly and retry.
      this.wanderPauseUntil = ctx.time + this.wanderIdleMin;
      return;
    }

    const remaining = this.moveToward(tx, ty, this.wanderSpeed, ctx.dt, (wx, wy) =>
      this.canEnter(wx, wy, ctx),
    );
    if (remaining > this.wanderArriveEpsilon) return;

    // Arrived. Drop the target so the next pick is fresh, then idle.
    this.wanderTargetX = null;
    this.wanderTargetY = null;
    const span = Math.max(0, this.wanderIdleMax - this.wanderIdleMin);
    this.wanderPauseUntil = ctx.time + this.wanderIdleMin + this.nextWanderRandom() * span;
  }

  private pickWanderTarget(ctx: EntityTickContext): void {
    const anchor = this.wanderAnchor();
    for (let attempt = 0; attempt < 8; attempt++) {
      const angle = this.nextWanderRandom() * Math.PI * 2;
      const r = 1 + this.nextWanderRandom() * Math.max(0, this.wanderRadius - 1);
      const tx = anchor.x + Math.cos(angle) * r;
      const ty = anchor.y + Math.sin(angle) * r;
      if (this.canEnter(Math.floor(tx), Math.floor(ty), ctx)) {
        this.wanderTargetX = tx;
        this.wanderTargetY = ty;
        return;
      }
    }
    // No valid tile in range — fall back to anchor centre. Picks resume
    // next pause cycle once surroundings change (e.g. pen built around
    // a stuck animal).
    this.wanderTargetX = anchor.x;
    this.wanderTargetY = anchor.y;
  }

  // Tiny LCG, [0, 1). Determinism is the only requirement here —
  // wander is cosmetic, not gameplay. Keyed on id (set in constructor)
  // so two entities with the same id wander identically; different
  // ids diverge.
  private nextWanderRandom(): number {
    this.wanderSeed = (this.wanderSeed * 1103515245 + 12345) | 0;
    return ((this.wanderSeed >>> 8) & 0xffffff) / 0x1000000;
  }

  // Public read-only view of the current wander target. Subclasses
  // shouldn't mutate it — the tick loop owns transitions. Returns the
  // anchor when no target is currently set (just-arrived / on cooldown).
  getWanderTarget(): { x: number; y: number } {
    if (this.wanderTargetX === null || this.wanderTargetY === null) {
      return this.wanderAnchor();
    }
    return { x: this.wanderTargetX, y: this.wanderTargetY };
  }

  // Apply hunger decay aligned to discrete sim ticks (frame ticks
  // shouldn't accelerate decay). Returns the number of sim ticks
  // elapsed since the last call so callers can drive other per-tick
  // logic (animal produce cycle, future need decay) on the same
  // cadence. First call after construction returns 0 — it just
  // captures the baseline tick.
  protected tickHunger(ctx: EntityTickContext): number {
    const tick = ctx.simTick;
    if (tick === undefined) return 0;
    if (this.lastHungerTick === null) {
      this.lastHungerTick = tick;
      return 0;
    }
    const elapsed = tick - this.lastHungerTick;
    if (elapsed <= 0) return 0;
    this.lastHungerTick = tick;
    this.needs.hunger = Math.max(0, this.needs.hunger - this.hungerDecayPerTick * elapsed);
    return elapsed;
  }

  // True if any tracked vital has hit 0. Hunger is the only vital
  // today; Phase 10.2 adds sleep / toilet etc., each as its own clause
  // here. entity_manager polls this after every tick and removes
  // dead entities (and emits a death notification).
  isDead(): boolean {
    return this.needs.hunger <= 0;
  }

  constructor(id: number, position: EntityPosition, facing: Facing = FACING_SOUTH) {
    super(id, position, facing);
    this.needs = makeFullNeeds();
    this.shortTermMemory = new Array(SHORT_TERM_CAPACITY).fill(null).map(() => ({
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
    this.maxCarryWeight = DEFAULT_MAX_CARRY_WEIGHT;
    this.maxStackSize = MAX_STACK_SIZE;
    // LCG seed for the shared wander RNG. id || 1 so a freshly-spawned
    // entity with id 0 (defensive — shouldn't happen) still has a
    // non-zero seed and produces motion.
    this.wanderSeed = id || 1;
    // Seed the initial wander target at the spawn position so the first
    // tick arrives instantly — a freshly-spawned entity stands still
    // for one wanderIdle cycle before walking, matching the pre-9.2
    // Villager behaviour. Without this, every entity would teleport-
    // walk a fraction of a tile on its very first frame.
    this.wanderTargetX = this.worldX();
    this.wanderTargetY = this.worldY();
  }

  // Sum of carried counts across all item types. Used by tests and
  // legacy code paths; new code should prefer carriedWeight().
  carriedTotal(): number {
    let n = 0;
    for (const c of this.carriedItems.values()) n += c;
    return n;
  }

  // Sum of carried weight in deci-units. Hot path during the
  // overweight check after every successful pickup, so no per-call
  // allocation. Walking the Map is O(k) where k is the number of
  // distinct item types currently held — typically <4.
  carriedWeight(): number {
    let w = 0;
    for (const [item, count] of this.carriedItems) w += getItemWeight(item) * count;
    return w;
  }

  // True iff the entity should drop everything at the next opportunity.
  // Threshold is fractional in [0,1]; defaults to 0.7 so settlers
  // deposit before they're literally full — keeps a planning cycle
  // from being wasted on a too-full settler claiming a harvest it
  // can't really take. Callers can pass 1.0 for a hard "completely
  // full" check.
  isOverweight(threshold = 0.7): boolean {
    if (this.maxCarryWeight <= 0) return this.carriedItems.size > 0;
    return this.carriedWeight() >= Math.floor(this.maxCarryWeight * threshold);
  }

  // Try to add `n` of `item`, clamped by remaining weight budget AND
  // by the per-stack cap. Returns the count actually added — callers
  // use this to know whether the world still owes them something
  // (e.g. a partial harvest that should re-emit). Pickup is atomic
  // per call: either the clamped quantity goes in or zero goes in.
  pickup(item: ItemId, n: number): number {
    if (n <= 0) return 0;
    const w = getItemWeight(item);
    // Items with zero weight (or unknown ids) can still respect the
    // stack cap; the weight clamp is skipped to avoid div-by-zero.
    let room = n;
    if (w > 0) {
      const weightRoom = Math.max(0, this.maxCarryWeight - this.carriedWeight());
      room = Math.min(room, Math.floor(weightRoom / w));
    }
    const have = this.carriedItems.get(item) ?? 0;
    const stackRoom = Math.max(0, this.maxStackSize - have);
    const taken = Math.min(room, stackRoom);
    if (taken <= 0) return 0;
    this.carriedItems.set(item, have + taken);
    return taken;
  }

  // Remove and return up to `n` of `item`. Returns the count actually
  // given. Empty stacks are deleted so iteration over carriedItems
  // never has to skip zeroed entries.
  drop(item: ItemId, n: number): number {
    if (n <= 0) return 0;
    const have = this.carriedItems.get(item) ?? 0;
    const taken = Math.min(have, n);
    if (taken === 0) return 0;
    const remaining = have - taken;
    if (remaining === 0) this.carriedItems.delete(item);
    else this.carriedItems.set(item, remaining);
    return taken;
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
