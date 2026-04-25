// 2D simplex noise. Permutation table is seeded per instance, so a single seed
// fully determines the noise field — required for deterministic generation.
// Reference: Stefan Gustavson, "Simplex noise demystified" (2005).

import { mulberry32 } from "./rng";

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

const GRAD3: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
  [1, 0],
  [-1, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [0, 1],
  [0, -1],
];

export type Noise2D = (x: number, y: number) => number;

export function createNoise2D(seed: number): Noise2D {
  const rng = mulberry32(seed);
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  // Fisher-Yates shuffle with the seeded RNG.
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = p[i] as number;
    p[i] = p[j] as number;
    p[j] = tmp;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255] as number;

  return (x: number, y: number): number => {
    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const t = (i + j) * G2;
    const x0 = x - (i - t);
    const y0 = y - (j - t);

    let i1 = 0;
    let j1 = 0;
    if (x0 > y0) i1 = 1;
    else j1 = 1;

    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;

    const ii = i & 255;
    const jj = j & 255;
    const gi0 = ((perm[ii + (perm[jj] as number)] as number) % 12) | 0;
    const gi1 = ((perm[ii + i1 + (perm[jj + j1] as number)] as number) % 12) | 0;
    const gi2 = ((perm[ii + 1 + (perm[jj + 1] as number)] as number) % 12) | 0;

    const dot = (gi: number, dx: number, dy: number): number => {
      const g = GRAD3[gi] as readonly [number, number];
      return g[0] * dx + g[1] * dy;
    };

    let n0 = 0;
    let n1 = 0;
    let n2 = 0;

    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) {
      t0 *= t0;
      n0 = t0 * t0 * dot(gi0, x0, y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) {
      t1 *= t1;
      n1 = t1 * t1 * dot(gi1, x1, y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) {
      t2 *= t2;
      n2 = t2 * t2 * dot(gi2, x2, y2);
    }

    // The 70 scaling factor brings results into roughly [-1, 1].
    return 70 * (n0 + n1 + n2);
  };
}

// Fractal noise: sum N octaves at decreasing amplitude / increasing frequency.
// Output normalized to [-1, 1] under standard 0.5 persistence.
export function fbm2(noise: Noise2D, x: number, y: number, octaves: number): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}
