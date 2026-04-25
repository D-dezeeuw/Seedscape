import { describe, expect, test } from "vitest";
import {
  buildInstanceBuffer,
  CHUNK_SIZE,
  createStaticChunk,
  TILES_PER_CHUNK,
  tileIndex,
} from "./static_chunk";

describe("tileIndex", () => {
  test("(0,0) is index 0 and (31,31) is the last index", () => {
    expect(tileIndex(0, 0)).toBe(0);
    expect(tileIndex(CHUNK_SIZE - 1, CHUNK_SIZE - 1)).toBe(TILES_PER_CHUNK - 1);
  });
});

describe("createStaticChunk", () => {
  test("populates exactly TILES_PER_CHUNK entries", () => {
    const chunk = createStaticChunk(42);
    expect(chunk.tileId.length).toBe(TILES_PER_CHUNK);
    expect(chunk.state.length).toBe(TILES_PER_CHUNK);
    expect(chunk.metadata.length).toBe(TILES_PER_CHUNK);
  });

  test("is deterministic for a given seed", () => {
    const a = createStaticChunk(7);
    const b = createStaticChunk(7);
    expect(Array.from(a.tileId)).toEqual(Array.from(b.tileId));
  });

  test("differs across seeds", () => {
    const a = createStaticChunk(1);
    const b = createStaticChunk(2);
    expect(Array.from(a.tileId)).not.toEqual(Array.from(b.tileId));
  });
});

describe("buildInstanceBuffer", () => {
  test("produces 4 floats per tile with correct world offsets", () => {
    const chunk = createStaticChunk(1);
    const buf = buildInstanceBuffer(chunk, 100, 200);
    expect(buf.length).toBe(TILES_PER_CHUNK * 4);
    // first tile: (100, 200), last tile (31,31): (131, 231)
    expect(buf[0]).toBe(100);
    expect(buf[1]).toBe(200);
    const lastOffset = (TILES_PER_CHUNK - 1) * 4;
    expect(buf[lastOffset]).toBe(131);
    expect(buf[lastOffset + 1]).toBe(231);
  });

  test("tileIndex slot matches chunk.tileId", () => {
    const chunk = createStaticChunk(5);
    const buf = buildInstanceBuffer(chunk, 0, 0);
    for (let i = 0; i < TILES_PER_CHUNK; i++) {
      expect(buf[i * 4 + 2]).toBe(chunk.tileId[i]);
    }
  });
});
