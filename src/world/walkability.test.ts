import { describe, expect, test } from "vitest";
import { allocChunkData, TILES_PER_CHUNK, tileIndex } from "./chunk";
import { buildChunkMask, isEntityWalkable, isWaterSource } from "./walkability";

describe("isEntityWalkable", () => {
  test("water blocks", () => {
    expect(isEntityWalkable(0)).toBe(false); // shallow
    expect(isEntityWalkable(1)).toBe(false); // deep
    expect(isEntityWalkable(30)).toBe(false); // swamp
  });

  test("buildings block", () => {
    expect(isEntityWalkable(200)).toBe(false);
    expect(isEntityWalkable(210)).toBe(false);
    expect(isEntityWalkable(299)).toBe(false);
  });

  test("ground / soil / crops are walkable", () => {
    expect(isEntityWalkable(10)).toBe(true); // dry grass
    expect(isEntityWalkable(11)).toBe(true); // rich soil
    expect(isEntityWalkable(13)).toBe(true); // tilled
    expect(isEntityWalkable(31)).toBe(true); // mudflat (soft but passable)
    expect(isEntityWalkable(100)).toBe(true); // crop
    expect(isEntityWalkable(199)).toBe(true);
  });
});

describe("isWaterSource", () => {
  test("shallow water and wells are sources", () => {
    expect(isWaterSource(0)).toBe(true);
    expect(isWaterSource(201)).toBe(true);
  });
  test("deep water and swamp are not sources (unreachable)", () => {
    expect(isWaterSource(1)).toBe(false);
    expect(isWaterSource(30)).toBe(false);
  });
  test("ground/buildings are not sources", () => {
    expect(isWaterSource(10)).toBe(false);
    expect(isWaterSource(200)).toBe(false);
    expect(isWaterSource(13)).toBe(false);
  });
});

describe("buildChunkMask", () => {
  test("packs walkability into a Uint8Array(1024)", () => {
    const c = allocChunkData();
    // Default tileId=0 (shallow water) → all blocked.
    const mask = buildChunkMask(c);
    expect(mask.length).toBe(TILES_PER_CHUNK);
    expect(mask[0]).toBe(0);
    expect(mask[TILES_PER_CHUNK - 1]).toBe(0);
  });

  test("buildings block, ground passes", () => {
    const c = allocChunkData();
    for (let i = 0; i < TILES_PER_CHUNK; i++) c.tileId[i] = 10; // grass
    c.tileId[tileIndex(5, 5)] = 200; // building
    c.tileId[tileIndex(6, 5)] = 13; // tilled (walkable)
    const mask = buildChunkMask(c);
    expect(mask[tileIndex(5, 5)]).toBe(0);
    expect(mask[tileIndex(6, 5)]).toBe(1);
    expect(mask[0]).toBe(1);
  });

  test("reuses scratch buffer when provided", () => {
    const c = allocChunkData();
    const scratch = new Uint8Array(TILES_PER_CHUNK);
    const mask = buildChunkMask(c, scratch);
    expect(mask).toBe(scratch);
  });
});
