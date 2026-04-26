// Per-type name pools for new entities. Pure data + a deterministic
// picker — entity creation sites pass a seed (typically `worldSeed ^ id`)
// so a given world re-spawns the same characters in the same order.
//
// Lists are intentionally short: easy to scan, easy to grow. Add new
// names by appending — the picker uses modulo so order doesn't break
// previously-rolled saves.

import { mulberry32 } from "../../shared/rng";
import type { EntityType } from "./entity";

const HUMAN_NAMES: ReadonlyArray<string> = [
  "Mira",
  "Bram",
  "Tess",
  "Otto",
  "Liana",
  "Ren",
  "Hazel",
  "Cal",
  "Iris",
  "Wynn",
  "Jory",
  "Esme",
  "Quinn",
  "Soren",
  "Tova",
];

const ANIMAL_NAMES: ReadonlyArray<string> = [
  "Bessie",
  "Daisy",
  "Henrietta",
  "Wilma",
  "Cluck",
  "Mabel",
  "Pip",
  "Clover",
  "Ginger",
  "Buttercup",
];

const PET_NAMES: ReadonlyArray<string> = [
  "Biscuit",
  "Pebble",
  "Mochi",
  "Fern",
  "Dusty",
  "Snickers",
  "Pip",
  "Bean",
  "Olive",
  "Toast",
];

const MOUNT_NAMES: ReadonlyArray<string> = [
  "Comet",
  "Storm",
  "Bramble",
  "Willow",
  "Onyx",
  "Maple",
  "Star",
  "Thunder",
  "Cinder",
  "Ash",
];

const POOLS: Record<EntityType, ReadonlyArray<string>> = {
  villager: HUMAN_NAMES,
  animal: ANIMAL_NAMES,
  pet: PET_NAMES,
  mount: MOUNT_NAMES,
};

// Picks a name from the pool deterministically. `seed` mixes worldSeed
// with the entity id at the call site so simultaneous spawns differ.
export function pickName(type: EntityType, seed: number): string {
  const pool = POOLS[type];
  const rng = mulberry32(seed >>> 0);
  const idx = Math.floor(rng() * pool.length);
  return pool[idx] ?? "Unnamed";
}

// Exposed for tests / future "list every possible name" UI.
export function namePool(type: EntityType): ReadonlyArray<string> {
  return POOLS[type];
}
