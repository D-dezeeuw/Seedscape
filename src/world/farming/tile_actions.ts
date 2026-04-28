// Pure functions for the player's farming actions. Each one mutates a single
// tile in a ChunkData and returns whether the action was applied. Callers are
// responsible for setting dirty flags on the chunk record.
//
// Tile-state encoding:
//  - Ground: tileId = ground variant, state = 0 (or moisture in future)
//  - Farmland tilled: tileId = 13, state = 0
//  - Crop: tileId = crop base id, state = stage 0..7 (255 = wilted)
//  - Crop metadata: bits 0..2 fertilizer, bits 3..4 water (0..3), bits 5..7 reserved

import type { ItemId } from "../../state/items";
import type { ChunkData } from "../chunk";
import { tileIndex } from "../chunk";
import {
  CROP_STAGE_HARVESTABLE,
  CROP_STATE_WILTED,
  cropForSeed,
  cropForTile,
} from "./crop_registry";

// Tile IDs from data/tiles.json that the actions read or write.
const TILE_FARMLAND_TILLED = 13;
const TILE_RICH_SOIL = 11;
const TILE_DRY_GRASS = 10;
const TILE_FARMLAND_UNTILLED = 12;

const WATER_BITS_SHIFT = 3;
const WATER_BITS_MASK = 0b11000;
const WATER_MAX = 3;

export function getWaterLevel(metadata: number): number {
  return (metadata & WATER_BITS_MASK) >> WATER_BITS_SHIFT;
}

export function setWaterLevel(metadata: number, level: number): number {
  const clamped = Math.max(0, Math.min(WATER_MAX, level));
  return (metadata & ~WATER_BITS_MASK) | (clamped << WATER_BITS_SHIFT);
}

export function isTillable(tileId: number): boolean {
  // Bloomridge soil tiles only — water and rocky outcrops can't be tilled.
  return (
    tileId === TILE_RICH_SOIL || tileId === TILE_DRY_GRASS || tileId === TILE_FARMLAND_UNTILLED
  );
}

export function isPlantable(tileId: number, state: number): boolean {
  // Farmland that's been tilled and isn't holding a wilted crop.
  return tileId === TILE_FARMLAND_TILLED && state === 0;
}

export interface TileActionResult {
  applied: boolean;
  // For harvest: how many produce items the player gets back.
  yield?: number;
  produceItem?: ItemId;
  // For harvest: seed drop. Phase 10.1 — every successful harvest
  // returns a small random number of seeds (1..2) of the same crop
  // so the player / settlers can replant without buying every cycle.
  seedItem?: ItemId;
  seedYield?: number;
}

export function tillTile(chunk: ChunkData, x: number, y: number): TileActionResult {
  const i = tileIndex(x, y);
  const id = chunk.tileId[i] ?? 0;
  if (!isTillable(id)) return { applied: false };
  chunk.tileId[i] = TILE_FARMLAND_TILLED;
  chunk.state[i] = 0;
  chunk.metadata[i] = 0;
  return { applied: true };
}

export function plantSeed(
  chunk: ChunkData,
  x: number,
  y: number,
  seedItem: ItemId,
): TileActionResult {
  const i = tileIndex(x, y);
  const id = chunk.tileId[i] ?? 0;
  const state = chunk.state[i] ?? 0;
  if (!isPlantable(id, state)) return { applied: false };
  const crop = cropForSeed(seedItem);
  if (!crop) return { applied: false };
  chunk.tileId[i] = crop.id;
  chunk.state[i] = 0; // stage 0
  chunk.metadata[i] = setWaterLevel(0, 1); // start at water level 1 so growth can begin
  return { applied: true };
}

export function waterTile(chunk: ChunkData, x: number, y: number): TileActionResult {
  const i = tileIndex(x, y);
  const id = chunk.tileId[i] ?? 0;
  // Watering only meaningful on farmland and crops; silently no-op elsewhere.
  if (id !== TILE_FARMLAND_TILLED && cropForTile(id) === null) return { applied: false };
  const meta = chunk.metadata[i] ?? 0;
  const next = setWaterLevel(meta, WATER_MAX);
  if (next === meta) return { applied: false };
  chunk.metadata[i] = next;
  return { applied: true };
}

export function harvestTile(chunk: ChunkData, x: number, y: number): TileActionResult {
  const i = tileIndex(x, y);
  const id = chunk.tileId[i] ?? 0;
  const state = chunk.state[i] ?? 0;
  const crop = cropForTile(id);
  if (!crop) return { applied: false };

  if (state === CROP_STATE_WILTED) {
    // Reset wilted tiles back to tilled farmland; no yield.
    chunk.tileId[i] = TILE_FARMLAND_TILLED;
    chunk.state[i] = 0;
    chunk.metadata[i] = 0;
    return { applied: true, yield: 0, produceItem: crop.produceItem };
  }

  if (state < CROP_STAGE_HARVESTABLE) return { applied: false };

  chunk.tileId[i] = TILE_FARMLAND_TILLED;
  chunk.state[i] = 0;
  chunk.metadata[i] = 0;
  // Random 1 or 2 seeds per harvest. Math.random is fine here — the
  // sim is single-threaded on the main thread for this action and the
  // seed drop is gameplay-tunable, not deterministic-replay critical.
  const seedYield = 1 + (Math.random() < 0.5 ? 1 : 0);
  return {
    applied: true,
    yield: crop.harvestYield,
    produceItem: crop.produceItem,
    seedItem: crop.seedItem,
    seedYield,
  };
}
