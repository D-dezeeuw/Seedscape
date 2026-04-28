// Villager — human character. Wander state + soft-collide + carrying
// all live on LivingEntity now (Phase 9.2 refactor); this class adds
// the human-specific bits: name, gender, water reserve, job
// controller, plus the home-tile anchor + tuning the wander uses.

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
    // Wander tuning (radius 6, speed 4, idle 2-5s) matches the
    // LivingEntity defaults so no explicit assignment is needed.
  }

  protected override wanderAnchor(): { x: number; y: number } {
    return { x: this.homeWorldTileX + 0.5, y: this.homeWorldTileY + 0.5 };
  }

  tick(ctx: EntityTickContext): void {
    // Hunger decays every sim tick regardless of what the settler is
    // doing — a settler walking a job still gets hungry.
    this.tickHunger(ctx);
    // Phase 7: when services are wired, the job controller drives all
    // motion. Wander only runs when the controller declines to handle
    // the tick (no services, or no claimable job and reserves are full).
    if (ctx.services && this.jobs.tick(this, ctx, ctx.services)) return;
    this.tickWander(ctx);
  }
}
