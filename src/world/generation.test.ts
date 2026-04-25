import { describe, expect, test } from "vitest";
import { BLOOMRIDGE_TILES } from "./biomes/bloomridge";
import { TILES_PER_CHUNK } from "./chunk";
import { createWorldNoise, generateChunk } from "./generation";

const VALID_TILE_IDS = new Set<number>(Object.values(BLOOMRIDGE_TILES));

describe("generateChunk", () => {
  test("populates exactly TILES_PER_CHUNK entries", () => {
    const noise = createWorldNoise(7);
    const chunk = generateChunk(noise, 0, 0);
    expect(chunk.tileId.length).toBe(TILES_PER_CHUNK);
    expect(chunk.state.length).toBe(TILES_PER_CHUNK);
    expect(chunk.metadata.length).toBe(TILES_PER_CHUNK);
  });

  test("produces only Bloomridge tile IDs", () => {
    const noise = createWorldNoise(99);
    const chunk = generateChunk(noise, 3, -2);
    for (let i = 0; i < TILES_PER_CHUNK; i++) {
      expect(VALID_TILE_IDS.has(chunk.tileId[i] as number)).toBe(true);
    }
  });

  test("is deterministic for the same world seed and chunk coords", () => {
    const a = generateChunk(createWorldNoise(123), 5, 7);
    const b = generateChunk(createWorldNoise(123), 5, 7);
    expect(Array.from(a.tileId)).toEqual(Array.from(b.tileId));
  });

  test("differs across chunk coords (continuity proof)", () => {
    const noise = createWorldNoise(1);
    const a = generateChunk(noise, 0, 0);
    const b = generateChunk(noise, 1, 0);
    expect(Array.from(a.tileId)).not.toEqual(Array.from(b.tileId));
  });

  test("differs across world seeds", () => {
    const a = generateChunk(createWorldNoise(1), 0, 0);
    const b = generateChunk(createWorldNoise(2), 0, 0);
    expect(Array.from(a.tileId)).not.toEqual(Array.from(b.tileId));
  });

  test("reuses caller-provided ChunkData buffer", () => {
    const noise = createWorldNoise(1);
    const a = generateChunk(noise, 0, 0);
    const result = generateChunk(noise, 1, 1, a);
    expect(result).toBe(a);
  });
});
