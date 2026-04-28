// Pen registry — animal pens (Phase 9). Pens are passive tiles in the
// 400..499 "animal" range; each one anchors exactly one Animal entity
// that wanders within a small radius, decays hunger, and drops produce
// into the pen's output buffer when fed.
//
// Pens reuse `BuildingBufferStore` for the output buffer (eggs, milk
// waiting to be hauled). They don't have an input buffer — settlers
// feeding the pen consume `animalFeed` from their carry directly when
// they arrive at the pen tile, restoring the resident animal's hunger.
// That keeps the data model lean: pens are a tile + (optionally) a
// few output items.

import { ITEM_IDS, type ItemId } from "../../state/items";

export const TILE_CHICKEN_PEN = 400;
export const TILE_COW_PEN = 410;
export const PEN_RANGE_MIN = 400;
export const PEN_RANGE_MAX = 499;

// Animal-side hunger tuning. HUNGER_MAX itself lives on LivingEntity
// (universal need-byte cap); the constants below are pen-specific:
// producing one item costs HUNGER_COST_PER_PRODUCE, feeding raises
// hunger by HUNGER_RESTORE_PER_FEED, and PRODUCE_HUNGER_THRESHOLD
// gates the cycle so a starving animal stops producing instead of
// slowly starving to 0 while still laying eggs.
export const HUNGER_COST_PER_PRODUCE = 30;
export const HUNGER_RESTORE_PER_FEED = 80;
export const PRODUCE_HUNGER_THRESHOLD = 64;

// Threshold for emitting FEED_ANIMAL. Below this fraction of HUNGER_MAX,
// a settler should bring feed. 50% mirrors FEED_BUILDING's input-cap
// threshold so the player sees consistent "feed when half empty"
// behaviour across pens and active buildings.
export const FEED_ANIMAL_THRESHOLD_FRACTION = 0.5;

export interface PenDef {
  tileId: number;
  name: string;
  displayName: string;
  species: "chicken" | "cow";
  produceItem: ItemId;
  produceQuantity: number;
  // Sim ticks between produces when the resident animal is fed
  // (hunger ≥ PRODUCE_HUNGER_THRESHOLD). Cow milk is half as frequent
  // as chicken eggs so the heavier item doesn't drown the player.
  cycleTime: number;
  // Coins to place a fresh pen. Doesn't include the price of the animal
  // itself — that's a separate shop entry (see Phase 9 doc).
  placementCost: number;
  // String id for the unlock entry (see state/unlocks.ts).
  unlockId: string;
}

const PENS: ReadonlyArray<PenDef> = [
  {
    tileId: TILE_CHICKEN_PEN,
    name: "chicken_pen",
    displayName: "Chicken Pen",
    species: "chicken",
    produceItem: ITEM_IDS.EGG,
    produceQuantity: 1,
    cycleTime: 60,
    placementCost: 80,
    unlockId: "building.chicken_pen",
  },
  {
    tileId: TILE_COW_PEN,
    name: "cow_pen",
    displayName: "Cow Pen",
    species: "cow",
    produceItem: ITEM_IDS.MILK,
    produceQuantity: 1,
    cycleTime: 120,
    placementCost: 200,
    unlockId: "building.cow_pen",
  },
];

const BY_TILE = new Map<number, PenDef>(PENS.map((p) => [p.tileId, p]));
const BY_SPECIES = new Map<string, PenDef>(PENS.map((p) => [p.species, p]));

export function isPenTile(tileId: number): boolean {
  return tileId >= PEN_RANGE_MIN && tileId <= PEN_RANGE_MAX;
}

export function penForTile(tileId: number): PenDef | null {
  return BY_TILE.get(tileId) ?? null;
}

export function penForSpecies(species: string): PenDef | null {
  return BY_SPECIES.get(species) ?? null;
}

export function listPens(): ReadonlyArray<PenDef> {
  return PENS;
}

// Tile-level placement helper. Mirrors `setBuildingTile` but for pens —
// keeps the pen state byte at 0 and metadata at 0 (no cycle, no queue).
// Returns false if the target tile isn't buildable; caller refunds any
// coins it already spent on a failed placement.
import type { ChunkData } from "../chunk";
import { tileIndex } from "../chunk";
import { isBuildable } from "./building_actions";

export function setPenTile(chunk: ChunkData, x: number, y: number, pen: PenDef): boolean {
  const i = tileIndex(x, y);
  const id = chunk.tileId[i] ?? 0;
  const state = chunk.state[i] ?? 0;
  if (!isBuildable(id, state)) return false;
  chunk.tileId[i] = pen.tileId;
  chunk.state[i] = 0;
  chunk.metadata[i] = 0;
  return true;
}
