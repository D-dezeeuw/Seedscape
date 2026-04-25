// Crop registry. Source of truth is data/crops.json; this module mirrors the
// fields the simulation and rendering paths actually need, and adds a small
// helper layer (crop-id checks, base ID lookup, stage atlas index).
//
// Per docs/05_data_model.md, crop tiles occupy IDs 100..199. Each crop owns 8
// contiguous slots starting at its base ID — base+0..base+7 = stages 0..7.
// "tileId" stored in chunk.data is the BASE id; growth stage lives in
// chunk.state. Atlas index is computed at instance-buffer build time.

import { ITEM_IDS, type ItemId } from "../../state/items";

export const CROP_RANGE_MIN = 100;
export const CROP_RANGE_MAX = 199;
export const CROP_STAGES = 8; // stages 0..7
export const CROP_STAGE_HARVESTABLE = 7;
export const CROP_STATE_WILTED = 255;

export interface CropDef {
  id: number; // base tile id (e.g. 100 = wheat stage 0)
  name: string;
  displayName: string;
  baseRate: number; // ticks-per-stage scale; 1.0 = one stage per tick
  wiltThreshold: number; // ticks at water=0 before wilting
  harvestYield: number;
  seedItem: ItemId;
  produceItem: ItemId;
  unlockLevel: number;
}

// Phase 3 ships wheat only. Carrot/corn entries exist in data/crops.json but
// have no item-id mapping yet; Phase 4 wires them when unlocks come online.
const PHASE_3_CROPS: ReadonlyArray<CropDef> = [
  {
    id: 100,
    name: "wheat",
    displayName: "Wheat",
    baseRate: 1.0,
    wiltThreshold: 240,
    harvestYield: 4,
    seedItem: ITEM_IDS.WHEAT_SEED,
    produceItem: ITEM_IDS.WHEAT,
    unlockLevel: 1,
  },
];

const BY_BASE_ID = new Map<number, CropDef>(PHASE_3_CROPS.map((c) => [c.id, c]));
const BY_SEED_ITEM = new Map<ItemId, CropDef>(PHASE_3_CROPS.map((c) => [c.seedItem, c]));

export function isCropTile(tileId: number): boolean {
  return tileId >= CROP_RANGE_MIN && tileId <= CROP_RANGE_MAX;
}

// Find the crop that owns this tile id even if it's a stage offset (e.g. 103
// for wheat stage 3). Returns null for non-crop tile ids.
export function cropForTile(tileId: number): CropDef | null {
  if (!isCropTile(tileId)) return null;
  // Walk back from tileId looking for the nearest base; bounded by 8 stages.
  for (let offset = 0; offset < CROP_STAGES; offset++) {
    const candidate = BY_BASE_ID.get(tileId - offset);
    if (candidate) return candidate;
  }
  return null;
}

export function cropForBaseId(baseId: number): CropDef | null {
  return BY_BASE_ID.get(baseId) ?? null;
}

export function cropForSeed(seedItem: ItemId): CropDef | null {
  return BY_SEED_ITEM.get(seedItem) ?? null;
}

// Atlas slot to render for a crop tile at a given growth state. Wilted tiles
// reuse stage 0's slot — Phase 3 doesn't ship a wilted sprite; visually it
// shows as the seedling color but the tile-info panel labels it "wilted".
export function cropAtlasIndex(baseId: number, state: number): number {
  if (state === CROP_STATE_WILTED) return baseId;
  const stage = Math.min(CROP_STAGE_HARVESTABLE, Math.max(0, state));
  return baseId + stage;
}

export function listCrops(): ReadonlyArray<CropDef> {
  return PHASE_3_CROPS;
}
