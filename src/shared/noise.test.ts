import { describe, expect, test } from "vitest";
import { createNoise2D, domainWarp, fbm2 } from "./noise";

describe("createNoise2D", () => {
  test("is deterministic for the same seed", () => {
    const a = createNoise2D(1234);
    const b = createNoise2D(1234);
    for (let i = 0; i < 50; i++) {
      const x = i * 0.13;
      const y = i * 0.27;
      expect(a(x, y)).toBe(b(x, y));
    }
  });

  test("differs across seeds", () => {
    const a = createNoise2D(1);
    const b = createNoise2D(2);
    let differences = 0;
    for (let i = 0; i < 100; i++) {
      if (a(i * 0.1, i * 0.2) !== b(i * 0.1, i * 0.2)) differences++;
    }
    expect(differences).toBeGreaterThan(90);
  });

  test("output magnitude stays within ~[-1, 1]", () => {
    const noise = createNoise2D(7);
    let max = 0;
    let min = 0;
    for (let y = 0; y < 50; y++) {
      for (let x = 0; x < 50; x++) {
        const v = noise(x * 0.1, y * 0.1);
        if (v > max) max = v;
        if (v < min) min = v;
      }
    }
    // Simplex theoretical max is ~0.866, but accept generous bounds.
    expect(max).toBeLessThan(1.05);
    expect(min).toBeGreaterThan(-1.05);
  });
});

describe("fbm2", () => {
  test("matches single octave when octaves=1", () => {
    const noise = createNoise2D(99);
    expect(fbm2(noise, 0.3, 0.7, 1)).toBe(noise(0.3, 0.7));
  });

  test("output stays bounded across octaves", () => {
    const noise = createNoise2D(99);
    for (let i = 0; i < 100; i++) {
      const v = fbm2(noise, i * 0.1, i * 0.05, 4);
      expect(v).toBeGreaterThan(-1.5);
      expect(v).toBeLessThan(1.5);
    }
  });
});

describe("domainWarp", () => {
  test("strength=0 is the identity transform", () => {
    const wx = createNoise2D(1);
    const wy = createNoise2D(2);
    const out = domainWarp(3.5, -7.25, wx, wy, 0);
    expect(out.x).toBe(3.5);
    expect(out.y).toBe(-7.25);
  });

  test("is deterministic for fixed seeds + inputs", () => {
    const wx1 = createNoise2D(1);
    const wy1 = createNoise2D(2);
    const wx2 = createNoise2D(1);
    const wy2 = createNoise2D(2);
    const a = domainWarp(0.7, 0.3, wx1, wy1, 0.4);
    const b = domainWarp(0.7, 0.3, wx2, wy2, 0.4);
    expect(a.x).toBe(b.x);
    expect(a.y).toBe(b.y);
  });

  test("strength scales the perturbation", () => {
    const wx = createNoise2D(1);
    const wy = createNoise2D(2);
    const small = domainWarp(0.5, 0.5, wx, wy, 0.1);
    const large = domainWarp(0.5, 0.5, wx, wy, 1.0);
    const dxSmall = Math.abs(small.x - 0.5);
    const dxLarge = Math.abs(large.x - 0.5);
    expect(dxLarge).toBeGreaterThan(dxSmall);
  });

  test("decorrelated noise instances move x and y independently", () => {
    const wx = createNoise2D(1);
    const wy = createNoise2D(2);
    // Sample many points; most should have dx ≠ dy. Identical noise
    // instances would force dx === dy at every point.
    let differences = 0;
    for (let i = 0; i < 50; i++) {
      const px = i * 0.37;
      const py = i * 0.71;
      const out = domainWarp(px, py, wx, wy, 0.5);
      if (out.x - px !== out.y - py) differences++;
    }
    expect(differences).toBeGreaterThan(40);
  });
});
