// Villager — human character. Wander AI is the only behavior in MVP:
// pick a walkable tile within radius of home, walk to it, idle a few
// seconds, repeat. No needs/memory/mood logic yet (slots inherited from
// LivingEntity).
//
// The wander RNG is seeded per (worldSeed, id, decisionTime) so different
// villagers diverge and replays are reproducible.

import { mulberry32 } from "../../shared/rng";
import {
  type EntityPosition,
  type EntityTickContext,
  type EntityType,
  FACING_SOUTH,
  type Facing,
} from "./entity";
import { LivingEntity, VILLAGER_AVAILABLE_ACTIONS } from "./living_entity";
import type { Gender } from "./names";
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

// Villager-specific carry cap (deci-units). 100 = ≈10 wheat / 4 flour /
// 16 bread — enough for one harvest round trip, not enough to skip
// crate visits entirely. Tuned in concert with item weights in items.ts;
// raise both together if you find settlers depositing too eagerly.
const VILLAGER_MAX_CARRY_WEIGHT = 100;

export class Villager extends LivingEntity {
  readonly type: EntityType = "villager";

  name: string;
  // Gender pairs with the first name (data/names.json tags each entry).
  // Default "male" so test fixtures + tools that build villagers
  // without going through pickFullName don't need to specify; spawn
  // sites always overwrite this with the value from pickFullName.
  gender: Gender = "male";
  // Anchor point the wander AI loops around. Stored as world tile coords;
  // sub-tile target picked inside that tile's bounds.
  homeWorldTileX: number;
  homeWorldTileY: number;

  // Water reserve in 0..MAX_WATER_RESERVE. Mutated by HAUL_WATER (refill at
  // a water tile) and WATER_CROP (drain into a thirsty tile).
  waterReserve: number = 0;

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
    // Settlers carry produce; other entity classes (animals, mounts)
    // override this in their own constructors.
    this.maxCarryWeight = VILLAGER_MAX_CARRY_WEIGHT;
    // Initial target = current position. First tick will pick a real one.
    this.wanderTargetX = this.worldX();
    this.wanderTargetY = this.worldY();
    this.idleUntilTime = 0;
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
