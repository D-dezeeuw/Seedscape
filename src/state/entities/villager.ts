// Villager — human character. Wander AI is the only behavior in MVP:
// pick a walkable tile within radius of home, walk to it, idle a few
// seconds, repeat. No needs/memory/mood logic yet (slots inherited from
// LivingEntity).
//
// The wander RNG is seeded per (worldSeed, id, decisionTime) so different
// villagers diverge and replays are reproducible.

import { mulberry32 } from "../../shared/rng";
import type { ItemId } from "../items";
import {
  type EntityPosition,
  type EntityTickContext,
  type EntityType,
  FACING_SOUTH,
  type Facing,
} from "./entity";
import { LivingEntity, VILLAGER_AVAILABLE_ACTIONS } from "./living_entity";
import { VillagerJobController } from "./villager_jobs";

const WALK_SPEED_TILES_PER_SEC = 4;
const WANDER_RADIUS = 6;
const IDLE_SECONDS_MIN = 2;
const IDLE_SECONDS_MAX = 5;
const ARRIVE_EPSILON = 0.1;
// Cap how many random tiles we try per pick before falling back to home.
const PICK_ATTEMPTS = 8;

// Water reserve: 0..MAX_WATER_RESERVE; refilled by HAUL_WATER, drained by
// WATER_CROP. MAX is small so settlers actually have to walk back for refills
// — that's the whole point of the haul job existing.
export const MAX_WATER_RESERVE = 5;
// Inventory cap: total items, summed across types. Settlers carry a few
// crops between harvest and the nearest crate; not a backpack.
export const MAX_CARRIED_ITEMS = 10;

export class Villager extends LivingEntity {
  readonly type: EntityType = "villager";

  name: string;
  // Anchor point the wander AI loops around. Stored as world tile coords;
  // sub-tile target picked inside that tile's bounds.
  homeWorldTileX: number;
  homeWorldTileY: number;

  // Water reserve in 0..MAX_WATER_RESERVE. Mutated by HAUL_WATER (refill at
  // a water tile) and WATER_CROP (drain into a thirsty tile).
  waterReserve: number = 0;
  // Items the settler is carrying between harvest and crate. Keyed flat;
  // matches Inventory's shape so any future "deposit all to inventory" path
  // can reuse the same iteration. Total count capped at MAX_CARRIED_ITEMS.
  readonly carriedItems = new Map<ItemId, number>();

  private wanderTargetX: number;
  private wanderTargetY: number;
  // When `idleUntilTime > ctx.time`, the villager stays put. 0 means "go
  // immediately on next tick" (initial state).
  private idleUntilTime: number;
  // Phase 7 job state machine. When services are present in ctx, this
  // takes priority over wander; when absent (existing tests, headless
  // sims) the villager wanders as before.
  readonly jobs = new VillagerJobController();

  constructor(
    id: number,
    position: EntityPosition,
    name: string,
    homeWorldTile: { x: number; y: number },
    facing: Facing = FACING_SOUTH,
  ) {
    super(id, position, facing);
    this.name = name;
    this.homeWorldTileX = homeWorldTile.x;
    this.homeWorldTileY = homeWorldTile.y;
    this.availableActions = VILLAGER_AVAILABLE_ACTIONS;
    // Initial target = current position. First tick will pick a real one.
    this.wanderTargetX = this.worldX();
    this.wanderTargetY = this.worldY();
    this.idleUntilTime = 0;
  }

  // Total items carried across all types — used by the carry-cap check.
  carriedTotal(): number {
    let n = 0;
    for (const c of this.carriedItems.values()) n += c;
    return n;
  }

  // Try to add `n` of `item`, clamped by MAX_CARRIED_ITEMS. Returns the
  // count actually added.
  pickup(item: ItemId, n: number): number {
    if (n <= 0) return 0;
    const room = Math.max(0, MAX_CARRIED_ITEMS - this.carriedTotal());
    const taken = Math.min(n, room);
    if (taken === 0) return 0;
    this.carriedItems.set(item, (this.carriedItems.get(item) ?? 0) + taken);
    return taken;
  }

  // Remove and return up to `n` of `item`. Returns the count actually given.
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

  tick(ctx: EntityTickContext): void {
    // Phase 7: when services are wired, the job controller drives all
    // motion. Wander only runs when the controller declines to handle
    // the tick (no services, or no claimable job and reserves are full).
    if (ctx.services && this.jobs.tick(this, ctx, ctx.services)) return;

    if (ctx.time < this.idleUntilTime) return;

    const remaining = this.moveToward(
      this.wanderTargetX,
      this.wanderTargetY,
      WALK_SPEED_TILES_PER_SEC,
      ctx.dt,
      ctx.isWalkable,
    );
    if (remaining > ARRIVE_EPSILON) return;

    // Arrived: idle a bit, then pick a new target.
    const rng = villagerRng(ctx.worldSeed, this.id, ctx.time);
    this.idleUntilTime =
      ctx.time + IDLE_SECONDS_MIN + rng() * (IDLE_SECONDS_MAX - IDLE_SECONDS_MIN);
    this.pickNewWanderTarget(ctx, rng);
  }

  private pickNewWanderTarget(ctx: EntityTickContext, rng: () => number): void {
    for (let i = 0; i < PICK_ATTEMPTS; i++) {
      const angle = rng() * Math.PI * 2;
      const r = 1 + rng() * (WANDER_RADIUS - 1);
      const tx = this.homeWorldTileX + 0.5 + Math.cos(angle) * r;
      const ty = this.homeWorldTileY + 0.5 + Math.sin(angle) * r;
      if (ctx.isWalkable(Math.floor(tx), Math.floor(ty))) {
        this.wanderTargetX = tx;
        this.wanderTargetY = ty;
        return;
      }
    }
    // No valid tile in range — return to home center.
    this.wanderTargetX = this.homeWorldTileX + 0.5;
    this.wanderTargetY = this.homeWorldTileY + 0.5;
  }

  // Test/save hook — exposes the current target without making the field
  // public-mutable from outside.
  getWanderTarget(): { x: number; y: number } {
    return { x: this.wanderTargetX, y: this.wanderTargetY };
  }
}

// Mix three integers into a 32-bit seed. `time` is fractional; multiply
// to keep enough resolution before truncating.
function villagerRng(worldSeed: number, id: number, time: number): () => number {
  const t = Math.floor(time * 1000) | 0;
  const seed = (worldSeed ^ id ^ Math.imul(t, 0x9e3779b1)) >>> 0;
  return mulberry32(seed);
}
