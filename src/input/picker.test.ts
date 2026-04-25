import { describe, expect, test } from "vitest";
import { CHUNK_SIZE } from "../world/chunk";
import { pickTile } from "./picker";

describe("pickTile", () => {
  test("center of canvas at camera origin returns tile (0,0)", () => {
    const r = pickTile(500, 300, 1000, 600, 0, 0, 1, 1);
    expect(r.worldTileX).toBe(0);
    expect(r.worldTileY).toBe(0);
    expect(r.chunkX).toBe(0);
    expect(r.chunkY).toBe(0);
    expect(r.localX).toBe(0);
    expect(r.localY).toBe(0);
  });

  test("camera offset shifts the picked tile", () => {
    const r = pickTile(500, 300, 1000, 600, 50, 0, 1, 1);
    expect(r.worldTileX).toBe(50);
    expect(r.chunkX).toBe(Math.floor(50 / CHUNK_SIZE));
    expect(r.localX).toBe(50 % CHUNK_SIZE);
  });

  test("screen Y inverts vs world Y", () => {
    // 100px above center → +100 world units up at zoom=1
    const r = pickTile(500, 200, 1000, 600, 0, 0, 1, 1);
    expect(r.worldTileY).toBeGreaterThan(0);
    const r2 = pickTile(500, 400, 1000, 600, 0, 0, 1, 1);
    expect(r2.worldTileY).toBeLessThan(0);
  });

  test("zoom scales world distance per pixel", () => {
    // At zoom=2, 100px right → +200 world units.
    const r = pickTile(600, 300, 1000, 600, 0, 0, 2, 1);
    expect(r.worldTileX).toBe(200);
  });

  test("negative coords have correct local indices", () => {
    const r = pickTile(0, 0, 1000, 600, -100, -100, 1, 1);
    // World tile coords should be negative; local should still be in 0..31.
    expect(r.localX).toBeGreaterThanOrEqual(0);
    expect(r.localX).toBeLessThan(CHUNK_SIZE);
    expect(r.localY).toBeGreaterThanOrEqual(0);
    expect(r.localY).toBeLessThan(CHUNK_SIZE);
  });
});
