import { describe, expect, test } from "vitest";
import {
  allocChunkData,
  buildInstanceBuffer,
  CHUNK_SIZE,
  TILES_PER_CHUNK,
  tileIndex,
} from "./chunk";

describe("tileIndex", () => {
  test("(0,0) is index 0 and (31,31) is the last index", () => {
    expect(tileIndex(0, 0)).toBe(0);
    expect(tileIndex(CHUNK_SIZE - 1, CHUNK_SIZE - 1)).toBe(TILES_PER_CHUNK - 1);
  });
});

describe("allocChunkData", () => {
  test("returns three correctly-sized typed arrays", () => {
    const c = allocChunkData();
    expect(c.tileId.length).toBe(TILES_PER_CHUNK);
    expect(c.state.length).toBe(TILES_PER_CHUNK);
    expect(c.metadata.length).toBe(TILES_PER_CHUNK);
    expect(c.tileId).toBeInstanceOf(Uint16Array);
    expect(c.state).toBeInstanceOf(Uint8Array);
    expect(c.metadata).toBeInstanceOf(Uint8Array);
  });
});

describe("buildInstanceBuffer", () => {
  test("produces 4 floats per tile with correct world offsets", () => {
    const c = allocChunkData();
    for (let i = 0; i < TILES_PER_CHUNK; i++) c.tileId[i] = i & 0xff;
    const buf = buildInstanceBuffer(c, 100, 200);
    expect(buf.length).toBe(TILES_PER_CHUNK * 4);
    expect(buf[0]).toBe(100);
    expect(buf[1]).toBe(200);
    const lastOffset = (TILES_PER_CHUNK - 1) * 4;
    expect(buf[lastOffset]).toBe(100 + CHUNK_SIZE - 1);
    expect(buf[lastOffset + 1]).toBe(200 + CHUNK_SIZE - 1);
  });

  test("reuses caller-provided buffer when given", () => {
    const c = allocChunkData();
    const buf = new Float32Array(TILES_PER_CHUNK * 4);
    const result = buildInstanceBuffer(c, 0, 0, buf);
    expect(result).toBe(buf);
  });
});
