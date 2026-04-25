import { describe, expect, test } from "vitest";
import { CHUNK_SIZE } from "./chunk";
import {
  chunkFromWorldTile,
  chunkKey,
  chunkOriginWorldTile,
  chunkRectArea,
  visibleChunkRect,
} from "./coords";

describe("chunkKey", () => {
  test("is consistent for identical coords", () => {
    expect(chunkKey(3, -7)).toBe(chunkKey(3, -7));
  });

  test("differs for different coords", () => {
    expect(chunkKey(3, -7)).not.toBe(chunkKey(-3, 7));
  });
});

describe("chunkFromWorldTile", () => {
  test("(0,0) world tile is in chunk (0,0)", () => {
    expect(chunkFromWorldTile(0, 0)).toEqual([0, 0]);
  });

  test("end of chunk (0,0)", () => {
    expect(chunkFromWorldTile(CHUNK_SIZE - 1, CHUNK_SIZE - 1)).toEqual([0, 0]);
  });

  test("start of chunk (1,1)", () => {
    expect(chunkFromWorldTile(CHUNK_SIZE, CHUNK_SIZE)).toEqual([1, 1]);
  });

  test("negative tile coords map to negative chunks", () => {
    expect(chunkFromWorldTile(-1, -1)).toEqual([-1, -1]);
    expect(chunkFromWorldTile(-CHUNK_SIZE, -CHUNK_SIZE)).toEqual([-1, -1]);
    expect(chunkFromWorldTile(-CHUNK_SIZE - 1, -1)).toEqual([-2, -1]);
  });
});

describe("chunkOriginWorldTile", () => {
  test("origin scales linearly", () => {
    expect(chunkOriginWorldTile(0, 0)).toEqual([0, 0]);
    expect(chunkOriginWorldTile(2, -3)).toEqual([2 * CHUNK_SIZE, -3 * CHUNK_SIZE]);
  });
});

describe("visibleChunkRect", () => {
  test("camera centered inside chunk (0,0) covers chunk (0,0)", () => {
    // Camera at chunk-center, viewport smaller than one chunk → rect spans
    // exactly one chunk on each axis.
    const rect = visibleChunkRect(CHUNK_SIZE / 2, CHUNK_SIZE / 2, 4, 4, 1, 1, 0);
    expect(rect.minX).toBe(0);
    expect(rect.maxX).toBe(1);
    expect(rect.minY).toBe(0);
    expect(rect.maxY).toBe(1);
  });

  test("expands by marginChunks on every side", () => {
    const rect = visibleChunkRect(CHUNK_SIZE / 2, CHUNK_SIZE / 2, 4, 4, 1, 1, 2);
    expect(rect.minX).toBe(-2);
    expect(rect.maxX).toBe(3);
    expect(rect.minY).toBe(-2);
    expect(rect.maxY).toBe(3);
  });

  test("camera offset shifts the rect to the matching chunk", () => {
    const rect = visibleChunkRect(
      CHUNK_SIZE * 5 + CHUNK_SIZE / 2,
      CHUNK_SIZE * 5 + CHUNK_SIZE / 2,
      4,
      4,
      1,
      1,
      0,
    );
    expect(rect.minX).toBe(5);
    expect(rect.maxX).toBe(6);
    expect(rect.minY).toBe(5);
    expect(rect.maxY).toBe(6);
  });

  test("viewport spanning multiple chunks expands the rect", () => {
    // 2 chunks × 2 chunks viewport at origin
    const rect = visibleChunkRect(CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE * 2, CHUNK_SIZE * 2, 1, 1, 0);
    expect(rect.maxX - rect.minX).toBe(2);
    expect(rect.maxY - rect.minY).toBe(2);
  });
});

describe("chunkRectArea", () => {
  test("computes width * height", () => {
    expect(chunkRectArea({ minX: 0, maxX: 4, minY: 0, maxY: 3 })).toBe(12);
    expect(chunkRectArea({ minX: 5, maxX: 5, minY: 0, maxY: 10 })).toBe(0);
    expect(chunkRectArea({ minX: 5, maxX: 4, minY: 0, maxY: 10 })).toBe(0);
  });
});
