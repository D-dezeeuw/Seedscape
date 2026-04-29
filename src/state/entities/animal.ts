// Animal hierarchy. Phase 9 ships farm animals (Chicken, Cow): they
// live tied to a pen tile, decay hunger over sim ticks, and drop
// produce into the pen's output buffer when fed.
//
//   Animal              → abstract; carries pen anchor + hunger field.
//     ProducerAnimal    → animals with a feed-and-produce cycle.
//       Chicken         → eggs.
//       Cow             → milk.
//     Pet               → follows owner (stub, Phase 12+).
//     Mount             → ride-able toggle (stub, Phase 12+).
//
// Hunger decays once per sim tick; produce cycle only advances while
// the animal is fed (hunger ≥ PRODUCE_HUNGER_THRESHOLD). Producing one
// item costs HUNGER_COST_PER_PRODUCE so a pen left untouched eventually
// stops producing instead of starving silently to zero.

import { OUTPUT_BUFFER_MULTIPLIER } from "../../world/farming/building_buffer";
import {
  HUNGER_COST_PER_PRODUCE,
  HUNGER_RESTORE_PER_FEED,
  isPenTile,
  PRODUCE_HUNGER_THRESHOLD,
  penForTile,
} from "../../world/farming/pen_registry";
import { ITEM_IDS, type ItemId } from "../items";
import type { EntityPosition, EntityTickContext, EntityType, Facing } from "./entity";
import { HUNGER_MAX, LivingEntity } from "./living_entity";

export abstract class Animal extends LivingEntity {
  // Species tag — used by render/UI to pick a sprite. Concrete species
  // classes will eventually replace the string with a typed registry.
  species: string;
  // World tile of the pen / coop. Animals stay near it when un-driven.
  penWorldTileX: number;
  penWorldTileY: number;

  constructor(
    id: number,
    position: EntityPosition,
    species: string,
    penWorldTile: { x: number; y: number },
    facing?: Facing,
  ) {
    super(id, position, facing);
    this.species = species;
    this.penWorldTileX = penWorldTile.x;
    this.penWorldTileY = penWorldTile.y;
    // Animals starve faster than settlers — Phase 9's HUNGER_DECAY_PER_TICK
    // was 1.0; keeping the same rate so existing pen tuning still feels
    // right.
    this.hungerDecayPerTick = 1.0;
  }

  // Default tick: stand still. Producers override with the hunger +
  // cycle pipeline; pets/mounts will eventually override with follow
  // / mounted behaviour.
  tick(_ctx: EntityTickContext): void {}
}

// Animals that turn food into a tradeable item on a fixed cycle.
// Chicken + Cow extend this; the produce item / cycle length differ
// per species but the tick logic is identical.
export abstract class ProducerAnimal extends Animal {
  // Sim ticks accumulated toward the next produce. Increments only
  // while the animal is fed; resets to 0 on a successful produce.
  produceProgress: number = 0;

  abstract readonly produceItem: ItemId;
  // Sim ticks per produce when fed. 60 ≈ one minute at 1 TPS.
  abstract readonly cycleTime: number;

  constructor(
    id: number,
    position: EntityPosition,
    species: string,
    penWorldTile: { x: number; y: number },
    facing?: Facing,
  ) {
    super(id, position, species, penWorldTile, facing);
    // Tighter wander than a settler: smaller radius (animals stay
    // near their pen), slower walk, shorter pauses so a pen of 8
    // animals always has something visibly moving.
    this.wanderRadius = 3;
    this.wanderSpeed = 0.6;
    this.wanderIdleMin = 1.5;
    this.wanderIdleMax = 4.5;
  }

  protected override wanderAnchor(): { x: number; y: number } {
    return { x: this.penWorldTileX + 0.5, y: this.penWorldTileY + 0.5 };
  }

  override tick(ctx: EntityTickContext): void {
    // Shared hunger decay; returns the elapsed sim-tick count so the
    // produce cycle advances on the same cadence.
    const elapsed = this.tickHunger(ctx);
    if (elapsed > 0 && this.needs.hunger >= PRODUCE_HUNGER_THRESHOLD) {
      // Produce cycle: only advances while fed. The threshold gate
      // stops a near-starved animal from emptying its hunger byte
      // mid-cycle.
      this.produceProgress += elapsed;
      if (this.produceProgress >= this.cycleTime) {
        const buffers = ctx.services?.buildingBuffers;
        if (buffers) {
          // Output cap mirrors active-building output: 3 × cycle qty.
          // For pens that's "enough room for three uncollected drops"
          // before further produces stall on a full buffer.
          const cap = 1 * OUTPUT_BUFFER_MULTIPLIER;
          buffers.addOutput(this.penWorldTileX, this.penWorldTileY, this.produceItem, 1, cap);
        }
        this.needs.hunger = Math.max(0, this.needs.hunger - HUNGER_COST_PER_PRODUCE);
        this.produceProgress = 0;
      }
    }

    // Inherited tickWander handles waypoint pick / walk / pause. The
    // species-pen constraint comes from canEnter, the smaller radius
    // / slower speed from the constructor overrides above.
    this.tickWander(ctx);
  }

  // ProducerAnimals stay inside their pen — same-species pen tiles
  // only. Drives wander pathing AND the soft-collide separation push,
  // so a chicken pushed off-tile by a sibling can only land on
  // another chicken pen tile (never grass, never a cow pen).
  override canEnter(worldTileX: number, worldTileY: number, ctx: EntityTickContext): boolean {
    const tw = ctx.services?.tileWorld;
    if (!tw) return ctx.isWalkable(worldTileX, worldTileY);
    return isSpeciesPenTile(tw, worldTileX, worldTileY, this.species);
  }

  // Called by FEED_ANIMAL when a settler arrives at the pen with feed.
  // Returns the amount actually consumed (may be 0 if already full).
  feed(): number {
    if (this.needs.hunger >= HUNGER_MAX) return 0;
    this.needs.hunger = Math.min(HUNGER_MAX, this.needs.hunger + HUNGER_RESTORE_PER_FEED);
    return 1;
  }
}

export class Chicken extends ProducerAnimal {
  readonly type: EntityType = "animal";
  readonly produceItem: ItemId = ITEM_IDS.EGG;
  readonly cycleTime = 60;

  constructor(
    id: number,
    position: EntityPosition,
    penWorldTile: { x: number; y: number },
    facing?: Facing,
  ) {
    super(id, position, "chicken", penWorldTile, facing);
  }
}

export class Cow extends ProducerAnimal {
  readonly type: EntityType = "animal";
  readonly produceItem: ItemId = ITEM_IDS.MILK;
  readonly cycleTime = 120;

  constructor(
    id: number,
    position: EntityPosition,
    penWorldTile: { x: number; y: number },
    facing?: Facing,
  ) {
    super(id, position, "cow", penWorldTile, facing);
  }
}

export class Pet extends Animal {
  readonly type: EntityType = "pet";

  // Entity id of the owner the pet should trail. Null when un-bonded.
  ownerId: number | null;
  followRadius: number;

  constructor(
    id: number,
    position: EntityPosition,
    species: string,
    penWorldTile: { x: number; y: number },
    ownerId: number | null = null,
    followRadius = 4,
  ) {
    super(id, position, species, penWorldTile);
    this.ownerId = ownerId;
    this.followRadius = followRadius;
  }
}

// True if (wx, wy) is a pen tile whose species matches `species`.
// Used as the per-step walkability check for animal wander so an
// animal stays on its own kind of pen tile (chickens don't wander
// into a cow pen, and neither leaves the pen for grass).
function isSpeciesPenTile(
  tw: import("./entity").TileWorldAccess,
  wx: number,
  wy: number,
  species: string,
): boolean {
  const t = tw.readTile(wx, wy);
  if (!t || !isPenTile(t.tileId)) return false;
  const def = penForTile(t.tileId);
  return def?.species === species;
}

export class Mount extends Animal {
  readonly type: EntityType = "mount";

  // True while a rider is mounted — movement is then driven externally
  // (by the rider's possession code) and tick logic is a no-op.
  ridden: boolean;
  riderId: number | null;

  constructor(
    id: number,
    position: EntityPosition,
    species: string,
    penWorldTile: { x: number; y: number },
  ) {
    super(id, position, species, penWorldTile);
    this.ridden = false;
    this.riderId = null;
  }
}
