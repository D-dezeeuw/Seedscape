// Per-type name pools for new entities. Pure data + a deterministic
// picker — entity creation sites pass a seed (typically `worldSeed ^ id`)
// so a given world re-spawns the same characters in the same order.
//
// Villagers draw from data/names.json (Dutch first names + surnames) and
// get a `Firstname Surname` combo. Animals/pets/mounts use the local
// short lists below — those domains aren't human-named in MVP and a
// 10-entry pool is plenty.

// Imported as a typed JSON module (resolveJsonModule). Vite copies the
// file into the bundle at build time; no runtime fetch required.
import namesData from "../../../data/names.json";
import { mulberry32 } from "../../shared/rng";
import type { EntityType } from "./entity";

// Per-villager gender. Drawn from the name entry's tag in data/names.json
// so a settler named "Maria" reads as female without needing a separate
// per-entity coin-flip — name and gender are the same decision. The
// type intentionally stays a simple union; if non-binary identities
// matter for gameplay later, expand here and the persistence layer
// handles it as a string.
export type Gender = "male" | "female";

// JSON shape: first_names is [name, gender][], surnames is string[].
// We carry the gender tag through pickFullName so spawn sites can stamp
// it onto the new villager.
type GenderedName = readonly [string, Gender];
const HUMAN_FIRST_NAMES_WITH_GENDER: ReadonlyArray<GenderedName> = (
  namesData.first_names as ReadonlyArray<ReadonlyArray<string>>
).map((entry) => [entry[0] ?? "Unnamed", (entry[1] ?? "male") as Gender] as const);
const HUMAN_FIRST_NAMES: ReadonlyArray<string> = HUMAN_FIRST_NAMES_WITH_GENDER.map(
  (entry) => entry[0],
);
const HUMAN_SURNAMES: ReadonlyArray<string> = namesData.surnames;

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

// Single-name pools per type. Villagers don't use this map directly —
// they go through pickFullName so they get a surname too.
const POOLS: Record<EntityType, ReadonlyArray<string>> = {
  villager: HUMAN_FIRST_NAMES,
  animal: ANIMAL_NAMES,
  pet: PET_NAMES,
  mount: MOUNT_NAMES,
};

// Picks a single name from the pool deterministically. `seed` mixes
// worldSeed with the entity id at the call site so simultaneous spawns
// differ. Used for non-human entities and as a building block for
// pickFullName.
export function pickName(type: EntityType, seed: number): string {
  const pool = POOLS[type];
  if (pool.length === 0) return "Unnamed";
  const rng = mulberry32(seed >>> 0);
  const idx = Math.floor(rng() * pool.length);
  return pool[idx] ?? "Unnamed";
}

// Picks a "Firstname Surname" combo for villagers along with the
// gender that pairs with the chosen first name. Surname is drawn from
// a second mulberry32 stream seeded off `seed ^ 0x9e37` so first and
// surname pick independently — otherwise short pools would force fixed
// pairings (every Jan would always be Jansen).
export function pickFullName(seed: number): { name: string; gender: Gender } {
  if (HUMAN_FIRST_NAMES_WITH_GENDER.length === 0) {
    return { name: "Unnamed", gender: "male" };
  }
  const rng = mulberry32(seed >>> 0);
  const idx = Math.floor(rng() * HUMAN_FIRST_NAMES_WITH_GENDER.length);
  const entry = HUMAN_FIRST_NAMES_WITH_GENDER[idx];
  const first = entry?.[0] ?? "Unnamed";
  const gender: Gender = entry?.[1] ?? "male";

  if (HUMAN_SURNAMES.length === 0) return { name: first, gender };
  const surnameRng = mulberry32((seed ^ 0x9e37) >>> 0);
  const surnameIdx = Math.floor(surnameRng() * HUMAN_SURNAMES.length);
  const surname = HUMAN_SURNAMES[surnameIdx] ?? "";
  return {
    name: surname.length > 0 ? `${first} ${surname}` : first,
    gender,
  };
}

// Exposed for tests / future "list every possible name" UI.
export function namePool(type: EntityType): ReadonlyArray<string> {
  return POOLS[type];
}

// Surname-only pool reader — kept symmetric with namePool. Useful for
// tests and any future UI that wants to enumerate the cast.
export function surnamePool(): ReadonlyArray<string> {
  return HUMAN_SURNAMES;
}
