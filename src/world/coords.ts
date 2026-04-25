// Coordinate space conversions and the chunk-key encoding used by every map
// keyed by chunk (LRU cache, in-flight set, renderer chunks).

import { CHUNK_SIZE } from "./chunk";

// Pack two 32-bit signed chunk coords into a single string. JS Map keys must
// be primitives for hash equality; bitwise packing into a Number doesn't fit
// because chunkX,chunkY together exceed 32 bits.
export function chunkKey(chunkX: number, chunkY: number): string {
  return `${chunkX | 0},${chunkY | 0}`;
}

export function chunkFromWorldTile(worldTileX: number, worldTileY: number): [number, number] {
  return [Math.floor(worldTileX / CHUNK_SIZE), Math.floor(worldTileY / CHUNK_SIZE)];
}

export function chunkOriginWorldTile(chunkX: number, chunkY: number): [number, number] {
  return [chunkX * CHUNK_SIZE, chunkY * CHUNK_SIZE];
}

// Chunk coordinate range visible at this camera, padded by `margin` chunks
// outside the frustum so streaming has lead time. Returns half-open
// [minChunkX, maxChunkX), [minChunkY, maxChunkY).
export interface ChunkRect {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function visibleChunkRect(
  cameraWorldX: number,
  cameraWorldY: number,
  viewportWidthPixels: number,
  viewportHeightPixels: number,
  zoomWorldUnitsPerPixel: number,
  tileWorldSize: number,
  marginChunks: number,
): ChunkRect {
  const halfW = (viewportWidthPixels * zoomWorldUnitsPerPixel) / 2;
  const halfH = (viewportHeightPixels * zoomWorldUnitsPerPixel) / 2;
  const minWorldTileX = (cameraWorldX - halfW) / tileWorldSize;
  const maxWorldTileX = (cameraWorldX + halfW) / tileWorldSize;
  const minWorldTileY = (cameraWorldY - halfH) / tileWorldSize;
  const maxWorldTileY = (cameraWorldY + halfH) / tileWorldSize;
  // Half-open interval: [min, max). `ceil` for the max bound so a viewport
  // edge that lands exactly on a chunk boundary doesn't pull in an empty extra
  // chunk on the far side.
  return {
    minX: Math.floor(minWorldTileX / CHUNK_SIZE) - marginChunks,
    maxX: Math.ceil(maxWorldTileX / CHUNK_SIZE) + marginChunks,
    minY: Math.floor(minWorldTileY / CHUNK_SIZE) - marginChunks,
    maxY: Math.ceil(maxWorldTileY / CHUNK_SIZE) + marginChunks,
  };
}

export function chunkRectArea(rect: ChunkRect): number {
  return Math.max(0, rect.maxX - rect.minX) * Math.max(0, rect.maxY - rect.minY);
}
