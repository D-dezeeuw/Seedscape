# Map Generation System (Node.js / JavaScript)

## Overview

This document specifies a deterministic, seeded, procedural map generation system based on layered scalar fields. The system generates tile-based terrain using noise functions, threshold banding, and optional biome modulation.

The approach is designed for:
- Infinite or chunked worlds
- Deterministic regeneration via seeds
- Efficient runtime classification (no heavy stacking at render time)

---

## Core Concept

We model terrain as a **continuous scalar field**:

```
H(x, y) ∈ [0, 1]
```

This field represents elevation (or "terrain energy"). Tile types are derived by partitioning this field into bands.

---

## Architecture

### Pipeline

```
Seed → Noise → Domain Warp → Fractal Composition → Normalize → Threshold Bands → Tile Mapping
```

### Modules

- `rng.js` — Seeded random generator
- `noise.js` — Noise functions (Perlin/OpenSimplex)
- `warp.js` — Domain warping
- `heightmap.js` — Builds scalar field H
- `biomes.js` — Optional biome classification
- `tiles.js` — Tile lookup logic
- `generator.js` — Orchestrates pipeline

---

## 1. Seeded Randomness

Determinism is critical.

### Example (Mulberry32)

```js
export function createRNG(seed) {
  return function() {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

---

## 2. Noise Generation

Use a coherent noise function.

Recommended:
- OpenSimplex (better isotropy than Perlin)

### Interface

```js
noise(x, y, seed) → float in [-1, 1]
```

---

## 3. Fractal Noise (fBm)

Combine multiple octaves for detail.

```js
export function fbm(x, y, noiseFn, {
  octaves = 5,
  lacunarity = 2.0,
  gain = 0.5
}) {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;

  for (let i = 0; i < octaves; i++) {
    sum += amplitude * noiseFn(x * frequency, y * frequency);
    norm += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }

  return sum / norm;
}
```

---

## 4. Domain Warping

Breaks symmetry and prevents circular artifacts.

```js
export function domainWarp(x, y, noiseFn, warpStrength = 0.5) {
  const qx = noiseFn(x, y);
  const qy = noiseFn(x + 100, y + 100);

  return {
    x: x + qx * warpStrength,
    y: y + qy * warpStrength
  };
}
```

---

## 5. Heightmap Construction

### Steps

```js
function getHeight(x, y, config) {
  const { noiseFn } = config;

  // Warp
  const warped = domainWarp(x, y, noiseFn, config.warpStrength);

  // Fractal noise
  let h = fbm(warped.x, warped.y, noiseFn, config.fbm);

  // Normalize [-1,1] → [0,1]
  h = (h + 1) / 2;

  return h;
}
```

---

## 6. Threshold Banding (Terrain Layers)

Defines terrain rings.

```js
const HEIGHT_BANDS = [
  { name: 'deep_water', max: 0.2 },
  { name: 'shallow_water', max: 0.3 },
  { name: 'beach', max: 0.35 },
  { name: 'fertile', max: 0.5 },
  { name: 'grass', max: 0.65 },
  { name: 'dry_grass', max: 0.75 },
  { name: 'barren', max: 0.85 },
  { name: 'rock', max: 1.0 }
];
```

### Classification

```js
export function getHeightBand(h) {
  for (const band of HEIGHT_BANDS) {
    if (h < band.max) return band.name;
  }
}
```

---

## 7. Optional: Moisture & Temperature Fields

Adds biome diversity.

```js
function getMoisture(x, y, noiseFn) {
  return (noiseFn(x + 2000, y + 2000) + 1) / 2;
}

function getTemperature(x, y, noiseFn) {
  return (noiseFn(x - 2000, y - 2000) + 1) / 2;
}
```

### Biome Mapping

```js
function getBiome(h, m, t) {
  if (h < 0.3) return 'water';

  if (m < 0.3) return 'desert';
  if (m > 0.7) return 'wetland';

  return 'temperate';
}
```

---

## 8. Tile Mapping

Final tile selection.

```js
export function getTile(x, y, config) {
  const h = getHeight(x, y, config);
  const band = getHeightBand(h);

  return {
    height: h,
    type: band
  };
}
```

---

## 9. Chunk Generation

Supports infinite worlds.

```js
export function generateChunk(chunkX, chunkY, size, config) {
  const tiles = [];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const worldX = chunkX * size + x;
      const worldY = chunkY * size + y;

      tiles.push(getTile(worldX, worldY, config));
    }
  }

  return tiles;
}
```

---

## 10. Smoothing Transitions

Avoid hard edges using smooth interpolation.

```js
function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
```

Use this for blending textures between bands.

---

## 11. Advanced Enhancements

### A. Erosion (Future Work)
- Hydraulic erosion simulation
- Thermal erosion

### B. Feature Placement
- Poisson disk sampling for trees/rocks
- Density based on biome

### C. Slope Detection

```js
function getSlope(x, y, config) {
  const h = getHeight(x, y, config);
  const hx = getHeight(x + 1, y, config);
  const hy = getHeight(x, y + 1, config);

  return Math.abs(h - hx) + Math.abs(h - hy);
}
```

Use slope to place cliffs or rocks.

---

## 12. Configuration Example

```js
const config = {
  seed: 12345,
  warpStrength: 0.4,
  noiseFn: createNoise(seed),
  fbm: {
    octaves: 5,
    lacunarity: 2.0,
    gain: 0.5
  }
};
```

---

## 13. Performance Considerations

- Cache noise evaluations if needed
- Generate per chunk, not full map
- Use Web Workers for async generation
- Consider WASM for heavy noise computation

---

## 14. Summary

This system:
- Uses a continuous scalar field
- Applies deterministic noise
- Partitions terrain via thresholds
- Produces natural ring-based topology
- Supports infinite worlds via chunking

It is simple, scalable, and extensible toward more advanced terrain simulation.

