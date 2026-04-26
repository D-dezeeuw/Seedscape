// Serialize / deserialize entities for save/load. Discriminated on the
// `type` tag so future entity classes (concrete farm animals, NPC roles)
// just add a new case here.
//
// Needs / memory / mood are NOT persisted yet — they're placeholders with
// fixed defaults. When those systems get real logic we bump SAVE_VERSION
// and start serializing them.

import { Mount, Pet } from "./animal";
import type { Entity, EntityType, Facing } from "./entity";
import { Villager } from "./villager";

export interface SavedEntity {
  id: number;
  type: EntityType;
  chunkX: number;
  chunkY: number;
  localX: number;
  localY: number;
  facing: Facing;

  // Per-type payload — only the field matching `type` is read.
  villager?: { name: string; homeWorldTileX: number; homeWorldTileY: number };
  pet?: {
    species: string;
    penWorldTileX: number;
    penWorldTileY: number;
    ownerId: number | null;
    followRadius: number;
  };
  mount?: { species: string; penWorldTileX: number; penWorldTileY: number };
}

export function serializeEntity(e: Entity): SavedEntity {
  const base: SavedEntity = {
    id: e.id,
    type: e.type,
    chunkX: e.chunkX,
    chunkY: e.chunkY,
    localX: e.localX,
    localY: e.localY,
    facing: e.facing,
  };
  if (e instanceof Villager) {
    base.villager = {
      name: e.name,
      homeWorldTileX: e.homeWorldTileX,
      homeWorldTileY: e.homeWorldTileY,
    };
  } else if (e instanceof Pet) {
    base.pet = {
      species: e.species,
      penWorldTileX: e.penWorldTileX,
      penWorldTileY: e.penWorldTileY,
      ownerId: e.ownerId,
      followRadius: e.followRadius,
    };
  } else if (e instanceof Mount) {
    base.mount = {
      species: e.species,
      penWorldTileX: e.penWorldTileX,
      penWorldTileY: e.penWorldTileY,
    };
  }
  return base;
}

export function deserializeEntity(saved: SavedEntity): Entity {
  const position = {
    chunkX: saved.chunkX,
    chunkY: saved.chunkY,
    localX: saved.localX,
    localY: saved.localY,
  };
  switch (saved.type) {
    case "villager": {
      const data = saved.villager;
      if (!data) throw new Error(`saved villager ${saved.id} missing villager payload`);
      return new Villager(
        saved.id,
        position,
        data.name,
        { x: data.homeWorldTileX, y: data.homeWorldTileY },
        saved.facing,
      );
    }
    case "pet": {
      const data = saved.pet;
      if (!data) throw new Error(`saved pet ${saved.id} missing pet payload`);
      return new Pet(
        saved.id,
        position,
        data.species,
        { x: data.penWorldTileX, y: data.penWorldTileY },
        data.ownerId,
        data.followRadius,
      );
    }
    case "mount": {
      const data = saved.mount;
      if (!data) throw new Error(`saved mount ${saved.id} missing mount payload`);
      return new Mount(saved.id, position, data.species, {
        x: data.penWorldTileX,
        y: data.penWorldTileY,
      });
    }
    case "animal":
      throw new Error(`abstract Animal cannot be deserialized — add a concrete species class`);
  }
}
