import { describe, expect, test } from "vitest";
import { CHUNK_SIZE, tileIndex } from "./chunk";
import { createWorldNoise, generateChunk, sampleHeight, sampleMoisture } from "./generation";

describe("generation determinism", () => {
  test("same seed + chunk → identical bytes", () => {
    const a = createWorldNoise(42);
    const b = createWorldNoise(42);
    const c1 = generateChunk(a, 0, 0);
    const c2 = generateChunk(b, 0, 0);
    expect(Array.from(c1.tileId)).toEqual(Array.from(c2.tileId));
  });

  test("different seeds produce different chunks at the same coords", () => {
    const c1 = generateChunk(createWorldNoise(1), 0, 0);
    const c2 = generateChunk(createWorldNoise(2), 0, 0);
    expect(Array.from(c1.tileId)).not.toEqual(Array.from(c2.tileId));
  });

  test("different chunks at the same seed have different tile patterns", () => {
    const noise = createWorldNoise(7);
    const a = generateChunk(noise, 0, 0);
    const b = generateChunk(noise, 1, 0);
    expect(Array.from(a.tileId)).not.toEqual(Array.from(b.tileId));
  });
});

describe("generation field samplers", () => {
  test("sampleHeight is reproducible per (seed, x, y)", () => {
    const a = sampleHeight(createWorldNoise(99), 12.5, -3);
    const b = sampleHeight(createWorldNoise(99), 12.5, -3);
    expect(a).toBe(b);
  });

  test("sampleHeight stays roughly in [-1, 1]", () => {
    const noise = createWorldNoise(99);
    let max = -Infinity;
    let min = Infinity;
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const v = sampleHeight(noise, x, y);
        if (v > max) max = v;
        if (v < min) min = v;
      }
    }
    expect(max).toBeLessThan(1.05);
    expect(min).toBeGreaterThan(-1.05);
  });

  test("sampleMoisture stays roughly in [-1, 1]", () => {
    const noise = createWorldNoise(99);
    for (let i = 0; i < 100; i++) {
      const v = sampleMoisture(noise, i * 1.7, i * 0.9);
      expect(v).toBeGreaterThan(-1.05);
      expect(v).toBeLessThan(1.05);
    }
  });
});

describe("generation produces a healthy mix of tiles", () => {
  test("a single chunk somewhere along a varied gradient surfaces multiple tile ids", () => {
    // World (0,0)..(96,96) — wide enough to sample several bands.
    const noise = createWorldNoise(0xc0ffee);
    const tiles = new Set<number>();
    for (let cx = 0; cx < 3; cx++) {
      for (let cy = 0; cy < 3; cy++) {
        const c = generateChunk(noise, cx, cy);
        for (let i = 0; i < CHUNK_SIZE * CHUNK_SIZE; i++) tiles.add(c.tileId[i] ?? 0);
      }
    }
    // 9 chunks across the gradient should produce at least 4 distinct
    // tile types from the 8 possible outputs.
    expect(tiles.size).toBeGreaterThanOrEqual(4);
  });

  test("deep water actually appears across a wide gradient (threshold tuning)", () => {
    // 5×5 chunks at the live world seed — the threshold band rewrite
    // exists so band 0 (deep water) isn't a vanishing slice. Smoke check
    // that some lake centers really land there.
    const noise = createWorldNoise(0xc0ffee);
    let deepWater = 0;
    for (let cx = -2; cx <= 2; cx++) {
      for (let cy = -2; cy <= 2; cy++) {
        const c = generateChunk(noise, cx, cy);
        for (let i = 0; i < CHUNK_SIZE * CHUNK_SIZE; i++) {
          if (c.tileId[i] === 1 /* deep water */) deepWater++;
        }
      }
    }
    expect(deepWater).toBeGreaterThan(0);
  });
});

describe("generation reuses preallocated buffers", () => {
  test("writing to `out` mutates the same arrays without allocating", () => {
    const noise = createWorldNoise(1);
    const out = generateChunk(noise, 0, 0);
    const buf = out.tileId.buffer;
    generateChunk(noise, 1, 0, out);
    expect(out.tileId.buffer).toBe(buf);
    // And tile (0,0) of chunk (1,0) should differ from tile (0,0) of chunk
    // (0,0) — confirming the buffer was actually rewritten.
    const fresh = generateChunk(noise, 0, 0);
    expect(out.tileId[tileIndex(0, 0)]).not.toBe(fresh.tileId[tileIndex(0, 0)]);
  });
});
