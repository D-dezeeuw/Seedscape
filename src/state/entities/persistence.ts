// Serialize / deserialize entities for save/load. Discriminated on the
// `type` tag so future entity classes (concrete farm animals, NPC roles)
// just add a new case here.
//
// Needs / memory / mood are NOT persisted yet — they're placeholders with
// fixed defaults. When those systems get real logic we bump SAVE_VERSION
// and start serializing them.

import type { ItemId } from "../items";
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
  villager?: {
    name: string;
    // Persisted as a free-form string so a future "non-binary" or
    // species-specific value doesn't force a save migration. Loader
    // narrows back to Gender at deserialize time; unknown values
    // default to "male" rather than rejecting the save.
    gender: string;
    homeWorldTileX: number;
    homeWorldTileY: number;
    // Phase 7: settler reserves + carried items survive save/load. Job
    // state (claim, current waypoint) and the task stack do NOT —
    // settlers re-enter idle on load, the emitter rebuilds the board on
    // the first tick, and any overweight settler auto-injects a fresh
    // deposit task. This is also why no SAVE_VERSION bump was needed
    // when the weight system landed: carriedItems shape is unchanged,
    // and an old save's counts that now exceed the weight cap are
    // resolved by the next idle tick rather than a load-time migration.
    waterReserve: number;
    carriedItems: { [itemId: number]: number };
  };
  pet?: {
    species: string;
    penWorldTileX: number;
    penWorldTileY: number;
    ownerId: number | null;
    followRadius: number;
  };
  // Mount carries runtime ride state too — possessing a mount is the
  // intended use case (Phase 6 plumbing, full feature later) and saving
  // mid-ride must not silently dismount the rider.
  mount?: {
    species: string;
    penWorldTileX: number;
    penWorldTileY: number;
    ridden: boolean;
    riderId: number | null;
  };
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
    const carried: { [itemId: number]: number } = {};
    for (const [item, count] of e.carriedItems) carried[item] = count;
    base.villager = {
      name: e.name,
      gender: e.gender,
      homeWorldTileX: e.homeWorldTileX,
      homeWorldTileY: e.homeWorldTileY,
      waterReserve: e.waterReserve,
      carriedItems: carried,
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
      ridden: e.ridden,
      riderId: e.riderId,
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
      const v = new Villager(
        saved.id,
        position,
        data.name,
        { x: data.homeWorldTileX, y: data.homeWorldTileY },
        saved.facing,
      );
      // Narrow gender back to the union; unknown values fall back to
      // "male" rather than rejecting an otherwise valid save.
      v.gender = data.gender === "female" ? "female" : "male";
      v.waterReserve = data.waterReserve;
      for (const [itemStr, count] of Object.entries(data.carriedItems)) {
        if (count > 0) v.carriedItems.set(Number(itemStr) as ItemId, count);
      }
      return v;
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
      const mount = new Mount(saved.id, position, data.species, {
        x: data.penWorldTileX,
        y: data.penWorldTileY,
      });
      mount.ridden = data.ridden;
      mount.riderId = data.riderId;
      return mount;
    }
    case "animal":
      throw new Error(`abstract Animal cannot be deserialized — add a concrete species class`);
  }
}
