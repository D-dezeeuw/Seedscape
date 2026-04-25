// Phase 1 placeholder: a single hardcoded 32x32 chunk used to validate the
// renderer end-to-end. The real chunk system arrives in Phase 2.

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

// Pick from ground-range tile IDs (0–99 per data/tiles.json) so the placeholder
// atlas's color grid is fully exercised, including edges of the 64x64 atlas.
const PALETTE: ReadonlyArray<number> = [0, 1, 10, 11, 12, 13, 20, 21, 22, 23, 24, 30, 31, 32, 33];

export function createStaticChunk(seed: number): ChunkData {
  const tileId = new Uint16Array(TILES_PER_CHUNK);
  const state = new Uint8Array(TILES_PER_CHUNK);
  const metadata = new Uint8Array(TILES_PER_CHUNK);

  // Cheap deterministic LCG to vary tiles per chunk without importing an RNG yet.
  let s = seed | 0 || 1;
  for (let y = 0; y < CHUNK_SIZE; y++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      s = (s * 1664525 + 1013904223) | 0;
      const palette = PALETTE[((s >>> 16) & 0x7fff) % PALETTE.length] as number;
      tileId[tileIndex(x, y)] = palette;
    }
  }

  return { tileId, state, metadata };
}

// Pack chunk + chunk world offset into the GPU instance buffer layout from
// docs/05_data_model.md: [worldX, worldY, tileIndex, stateFlags] x 1024.
export function buildInstanceBuffer(
  chunk: ChunkData,
  chunkWorldX: number,
  chunkWorldY: number,
): Float32Array {
  const out = new Float32Array(TILES_PER_CHUNK * 4);
  for (let y = 0; y < CHUNK_SIZE; y++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      const i = tileIndex(x, y);
      const offset = i * 4;
      out[offset] = chunkWorldX + x;
      out[offset + 1] = chunkWorldY + y;
      out[offset + 2] = chunk.tileId[i] ?? 0;
      out[offset + 3] = chunk.state[i] ?? 0;
    }
  }
  return out;
}
