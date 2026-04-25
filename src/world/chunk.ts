// Chunk primitives shared by every system: cache, generation, simulation,
// rendering, persistence. Per docs/05_data_model.md and the chunk-work skill.

export const CHUNK_SIZE = 32;
export const TILES_PER_CHUNK = CHUNK_SIZE * CHUNK_SIZE;

export interface ChunkData {
  tileId: Uint16Array;
  state: Uint8Array;
  metadata: Uint8Array;
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

// GPU instance buffer per docs/05_data_model.md. Layout per tile:
// [worldX, worldY, tileIndex, stateFlags] x 1024 = 16 KB.
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
      buffer[offset] = chunkWorldX + x;
      buffer[offset + 1] = chunkWorldY + y;
      buffer[offset + 2] = chunk.tileId[i] ?? 0;
      buffer[offset + 3] = chunk.state[i] ?? 0;
    }
  }
  return buffer;
}
