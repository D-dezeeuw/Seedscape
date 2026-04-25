# Seedscape — World Generation

## Principle

The world is deterministic. Given the same seed and chunk coordinates, generation always produces the same output.

---

## Seed System

- World seed: 32-bit integer (set at world creation)
- Chunk seed: derived per chunk

```
chunkSeed = hash(worldSeed, chunkX, chunkY)
```

- Hash function: fast, collision-resistant (e.g. MurmurHash3 or xxHash32)
- Seeded RNG per chunk: used for all noise, tile placement, variant selection

---

## Generation Pipeline

Per chunk:

1. **Biome lookup** — determine which biome owns this chunk
2. **Height/terrain noise** — base terrain shape
3. **Moisture noise** — water/fertility distribution
4. **Resource placement** — ores, trees, deposits
5. **Feature pass** — rivers, clearings, landmarks
6. **Tile assignment** — map noise values to tileIds
7. **State initialization** — set initial tile state + metadata

All passes are stateless and run in a worker.

---

## Noise Functions

| Layer    | Noise type       | Scale (tiles) | Purpose             |
|----------|-----------------|---------------|---------------------|
| Terrain  | Simplex / Value  | 64–256        | Base elevation      |
| Moisture | Simplex          | 32–128        | Soil wetness        |
| Resources| Worley / Voronoi | 16–64         | Ore/deposit patches |
| Biome    | Low-frequency    | 512–1024      | Biome boundary shape|

---

## Biome Assignment

Biome is determined by evaluating biome noise at the chunk center.

```
biomeId = classifyBiome(
  biomeNoise(chunkCenterX, chunkCenterY),
  moistureNoise(chunkCenterX, chunkCenterY)
)
```

Biome boundaries blend across 4–8 chunk transition zones.

| biomeNoise | moistureNoise | Biome               |
|------------|---------------|---------------------|
| Low        | High          | Sunfen Delta        |
| Low        | Low           | Bloomridge          |
| High       | Any           | Stoneveil Highlands |
| Very low   | Very low      | Voidsoil Expanse    |

---

## Bloomridge — Starter Zone

- Always generates near world origin (chunk 0,0)
- Forced biome override in a radius of 16 chunks from origin
- Gentle terrain, high moisture, no hostile conditions
- Tutorial-safe tile selection

---

## Resource Placement Rules

Resources are placed using Worley noise patch detection.

```
if (worleyF1(x, y, chunkSeed) < threshold)
  place resource deposit at tile
```

Each biome defines its own resource table and thresholds (see [08_biomes.md]).

---

## Feature Pass

After tile assignment, a feature pass overlays larger structures:

- **Rivers**: traced from high-elevation noise valleys
- **Clearings**: open patches for building starter farms
- **Landmarks**: single-chunk special features (ruins, wells, shrines)

Features are chunk-local; they do not span chunk boundaries in MVP.

---

## Tile Assignment Logic

Each tile maps noise values to a tileId via biome lookup table.

```
tileId = biome.tileTable[terrainBand][moistureBand]
```

Terrain bands: 0 (water/low) → 7 (peak/rock)
Moisture bands: 0 (arid) → 3 (saturated)

---

## Generation Phase Summary

| Phase       | Input                         | Output              |
|-------------|-------------------------------|---------------------|
| Biome lookup| chunkX, chunkY, worldSeed     | biomeId             |
| Terrain     | biomeId, chunkSeed            | heightmap[1024]     |
| Moisture    | chunkSeed                     | moisture[1024]      |
| Resources   | biomeId, chunkSeed, heightmap | resource[]          |
| Features    | heightmap, biomeId            | feature overlays    |
| Assignment  | all above                     | tileId[1024]        |
| Init        | tileId[1024]                  | state[], metadata[] |
