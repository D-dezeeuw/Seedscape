// Animal hierarchy — proves the entity base accepts non-human living
// entities. No instances spawn this phase; the classes exist so future
// spawn sites have a clear extension path. Animal itself stays abstract;
// concrete species (Chicken, Cow) will extend it in Phase 3.5.
//
//   Animal  → farm animals (chicken, cow, pig). Tied to a pen tile.
//   Pet     → follows an owner entity at radius. Adoptable.
//   Mount   → ride-able toggle; movement is driven by rider when mounted.
//
// All three reuse LivingEntity's needs / memory / moveToward helpers.

import {
  type EntityPosition,
  type EntityTickContext,
  type EntityType,
  type Facing,
} from "./entity";
import { LivingEntity } from "./living_entity";

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
  }

  // Default tick: stand still. Concrete species override with feeding-cycle
  // or wander behavior in a later phase.
  tick(_ctx: EntityTickContext): void {}
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
