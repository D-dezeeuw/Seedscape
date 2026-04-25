import { describe, expect, test } from "vitest";
import { hashChunkSeed, mulberry32 } from "./rng";

describe("mulberry32", () => {
  test("is deterministic for the same seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 8; i++) expect(a()).toBe(b());
  });

  test("differs across seeds", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const aSamples = [a(), a(), a()];
    const bSamples = [b(), b(), b()];
    expect(aSamples).not.toEqual(bSamples);
  });

  test("returns values in [0, 1)", () => {
    const r = mulberry32(123);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test("rough uniformity over 100k samples", () => {
    const r = mulberry32(7);
    const buckets = new Array(10).fill(0);
    const N = 100_000;
    for (let i = 0; i < N; i++) {
      const v = r();
      buckets[Math.min(9, Math.floor(v * 10))]++;
    }
    // No bucket should drift more than 5% from uniform.
    const expected = N / 10;
    for (const count of buckets) {
      expect(Math.abs(count - expected) / expected).toBeLessThan(0.05);
    }
  });
});

describe("hashChunkSeed", () => {
  test("is deterministic", () => {
    expect(hashChunkSeed(1, 2, 3)).toBe(hashChunkSeed(1, 2, 3));
  });

  test("changes when any input changes", () => {
    const base = hashChunkSeed(100, 0, 0);
    expect(hashChunkSeed(101, 0, 0)).not.toBe(base);
    expect(hashChunkSeed(100, 1, 0)).not.toBe(base);
    expect(hashChunkSeed(100, 0, 1)).not.toBe(base);
  });

  test("handles negative chunk coords without collision with positives", () => {
    expect(hashChunkSeed(1, -5, 7)).not.toBe(hashChunkSeed(1, 5, 7));
    expect(hashChunkSeed(1, 5, -7)).not.toBe(hashChunkSeed(1, 5, 7));
  });

  test("returns a Uint32 value", () => {
    const h = hashChunkSeed(0xabcdef, -123, 456);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(h)).toBe(true);
  });
});
