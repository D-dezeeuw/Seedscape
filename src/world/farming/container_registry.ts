// Container registry — the storage-tile-specific behaviour that
// building_registry doesn't model. building_registry handles costs, names,
// and placement; this module describes:
//   - which container tile ids exist
//   - which item ids each container accepts (crate = anything, dispenser =
//     seeds only)
//   - which containers auto-restock from the player's inventory each tick
//
// Container *contents* live in CrateStore (a single sparse Map<tileKey,
// Map<ItemId, count>>). Tile id chooses the policy; the store is generic.

import type { ItemId } from "../../state/items";

// Tile id constants live here so crate.ts and container_registry.ts
// don't form a circular import. crate.ts re-exports CRATE_TILE_ID for
// backwards compatibility with code written before the registry existed.
export const CRATE_TILE_ID = 220;
export const SEED_DISPENSER_TILE_ID = 221;

// Per-container behavioural metadata. Capacity is repeated from
// CrateStore's CRATE_CAPACITY because future containers may want their
// own (oven holds 8 dough, freezer holds 50 fish, etc.). Today both
// containers use the same default.
export interface ContainerDef {
  tileId: number;
  // Predicate for whether this container will accept an item. Crate
  // accepts everything; dispenser only takes seeds (item id 600..699).
  // Used by both the auto-restock path and the container window's
  // deposit button.
  acceptsItem: (id: ItemId) => boolean;
  // True if this container pulls items from the player's inventory each
  // sim tick. Currently only the seed dispenser does this.
  autoRestock: boolean;
}

const SEED_RANGE_MIN = 600;
const SEED_RANGE_MAX = 699;

const acceptAnything = (_id: ItemId): boolean => true;
const acceptSeedsOnly = (id: ItemId): boolean => id >= SEED_RANGE_MIN && id <= SEED_RANGE_MAX;

const DEFS: ReadonlyArray<ContainerDef> = [
  { tileId: CRATE_TILE_ID, acceptsItem: acceptAnything, autoRestock: false },
  { tileId: SEED_DISPENSER_TILE_ID, acceptsItem: acceptSeedsOnly, autoRestock: true },
];

const BY_TILE_ID = new Map(DEFS.map((d) => [d.tileId, d]));

export function isContainerTile(tileId: number): boolean {
  return BY_TILE_ID.has(tileId);
}

export function containerForTile(tileId: number): ContainerDef | null {
  return BY_TILE_ID.get(tileId) ?? null;
}

export function listContainers(): ReadonlyArray<ContainerDef> {
  return DEFS;
}

// Set of seed item ids the dispenser will pull. Returned as a number range
// helper rather than a registry lookup so emitters/state-machine code can
// quickly check "is this a seed?" without touching the container registry.
export function isSeedItem(id: number): boolean {
  return id >= SEED_RANGE_MIN && id <= SEED_RANGE_MAX;
}
