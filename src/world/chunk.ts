// Chunk primitives shared by every system: cache, generation, simulation,
// rendering, persistence. Per docs/05_data_model.md and the chunk-work skill.

import { cropAtlasIndex, isCropTile } from "./farming/crop_registry";

export const CHUNK_SIZE = 32;
export const TILES_PER_CHUNK = CHUNK_SIZE * CHUNK_SIZE;

export interface ChunkData {
  tileId: Uint16Array;
  state: Uint8Array;
  metadata: Uint8Array;
}

// Per docs/13_chunk_lifecycle.md and docs/05_data_model.md.
export const CHUNK_FLAG_DIRTY_SIMULATION = 1 << 0; // CPU diverged from disk
export const CHUNK_FLAG_DIRTY_RENDER = 1 << 1; // CPU diverged from GPU

export interface ChunkRecord {
  data: ChunkData;
  flags: number;
}

export function tileIndex(x: number, y: number): number {
  return y * CHUNK_SIZE + x;
}

export function allocChunkData(): ChunkData {
  return {
    tileId: new Uint16Array(TILES_PER_CHUNK),
    state: new Uint8Array(TILES_PER_CHUNK),
    metadata: new Uint8Array(TILES_PER_CHUNK),
  };
}

export function makeChunkRecord(data: ChunkData, flags = CHUNK_FLAG_DIRTY_RENDER): ChunkRecord {
  return { data, flags };
}

// Render-time atlas slot for a tile. Crops resolve to base+stage so the same
// chunk.tileId (the crop's base) renders different sprites as the crop grows;
// every other tile maps to its tileId directly.
export function renderAtlasIndex(tileId: number, state: number): number {
  if (isCropTile(tileId)) return cropAtlasIndex(tileId, state);
  return tileId;
}

// GPU instance buffer per docs/05_data_model.md. Layout per tile:
// [worldX, worldY, atlasIndex, stateFlags] x 1024 = 16 KB.
//
// stateFlags packing (matches the fragment shader):
//   bit 0 — wilted (state === CROP_STATE_WILTED)
//   bit 1 — watered (farmable tile with water level > 0)
//   bit 2 — selected (reserved for future use)
const TILE_FARMLAND_TILLED_GPU = 13;
const CROP_STATE_WILTED_GPU = 255;
// Water lives in metadata bits 3-4 (mirrors WATER_BITS in tile_actions).
const WATER_META_MASK = 0b11000;
const WATER_META_SHIFT = 3;

export function buildInstanceBuffer(
  chunk: ChunkData,
  chunkWorldX: number,
  chunkWorldY: number,
  out?: Float32Array,
): Float32Array {
  const buffer = out ?? new Float32Array(TILES_PER_CHUNK * 4);
  for (let y = 0; y < CHUNK_SIZE; y++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      const i = tileIndex(x, y);
      const offset = i * 4;
      const tileId = chunk.tileId[i] ?? 0;
      const state = chunk.state[i] ?? 0;
      const meta = chunk.metadata[i] ?? 0;
      buffer[offset] = chunkWorldX + x;
      buffer[offset + 1] = chunkWorldY + y;
      buffer[offset + 2] = renderAtlasIndex(tileId, state);

      let flags = 0;
      if (state === CROP_STATE_WILTED_GPU) flags |= 1;
      // Wet/dry visual gate: only farmable tiles (bare tilled soil or any
      // crop) get the watered bit. Stops grass + buildings from being
      // accidentally darkened by the shader's wet-soil pass.
      const farmable = tileId === TILE_FARMLAND_TILLED_GPU || isCropTile(tileId);
      const water = (meta & WATER_META_MASK) >> WATER_META_SHIFT;
      if (farmable && water > 0) flags |= 2;
      buffer[offset + 3] = flags;
    }
  }
  return buffer;
}
