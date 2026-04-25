# Seedscape — Biomes

## Overview

Biomes define the visual style, resource distribution, and gameplay conditions of world regions.

Each biome provides:
- Tile lookup table (terrain × moisture → tileId)
- Resource table (deposit types + thresholds)
- Gameplay modifiers (growth speed, yield, hazards)
- Visual rules (palette, atmosphere)

---

## Biome: Bloomridge

> Starter biome. Lush farmland with gentle terrain and abundant resources.

### Identity

| Property     | Value                        |
|--------------|------------------------------|
| Region       | World origin (forced, r=16)  |
| Climate      | Temperate, moist             |
| Difficulty   | Beginner                     |
| Terrain      | Flat to gently rolling       |

### Tiles

| Terrain band | Moisture | tileId group        |
|--------------|----------|---------------------|
| 0 (water)    | Any      | Shallow water       |
| 1–2          | High     | Rich soil           |
| 1–2          | Low      | Dry grass           |
| 3–5          | Any      | Farmland / meadow   |
| 6–7          | Any      | Rocky outcrop       |

### Resources

| Resource     | Rarity   | Notes                     |
|--------------|----------|---------------------------|
| Wheat seeds  | Common   | Starter crop              |
| Carrot seeds | Common   | Early unlock              |
| Stone        | Common   | Construction material     |
| Wood         | Common   | Forest patches            |
| Iron ore     | Uncommon | Small surface deposits    |

### Gameplay Modifiers

| Modifier         | Value |
|------------------|-------|
| Crop growth rate | 1.0×  |
| Soil fertility   | High  |
| Weather hazards  | None  |
| Water access     | Easy  |

---

## Biome: Stoneveil Highlands

> Rocky highland biome. Mineral-rich but harsh farming conditions.

### Identity

| Property     | Value                        |
|--------------|------------------------------|
| Climate      | Cold, dry                    |
| Difficulty   | Intermediate                 |
| Terrain      | High elevation, steep        |

### Tiles

| Terrain band | Moisture | tileId group        |
|--------------|----------|---------------------|
| 0–1          | Low      | Gravel / shale      |
| 2–4          | Any      | Rocky soil          |
| 5–6          | Any      | Barren stone        |
| 7            | Any      | Cliff face          |

### Resources

| Resource      | Rarity   | Notes                        |
|---------------|----------|------------------------------|
| Iron ore      | Common   | Surface veins                |
| Coal          | Common   | Deep deposits                |
| Copper ore    | Uncommon | Mid-tier resource            |
| Mountain herbs| Rare     | High-value crop variant      |
| Stone         | Abundant | Building surplus zone        |

### Gameplay Modifiers

| Modifier         | Value |
|------------------|-------|
| Crop growth rate | 0.7×  |
| Soil fertility   | Low   |
| Weather hazards  | Frost |
| Water access     | Hard  |

---

## Biome: Sunfen Delta

> Wetland biome. Fertile but waterlogged. Unique aquatic crops.

### Identity

| Property     | Value                        |
|--------------|------------------------------|
| Climate      | Humid, warm                  |
| Difficulty   | Intermediate                 |
| Terrain      | Flat, river-crossed          |

### Tiles

| Terrain band | Moisture | tileId group        |
|--------------|----------|---------------------|
| 0–1          | Any      | Swamp water         |
| 2–3          | High     | Mudflat / peat      |
| 3–5          | High     | Deltaic soil        |
| 5–7          | Low      | Raised grassland    |

### Resources

| Resource      | Rarity   | Notes                         |
|---------------|----------|-------------------------------|
| Rice seeds    | Common   | Aquatic crop (unique biome)   |
| Reeds         | Common   | Crafting material             |
| Clay          | Common   | Pottery / construction        |
| Exotic fish   | Uncommon | Economy commodity             |
| Rare herbs    | Rare     | High-value trade goods        |

### Gameplay Modifiers

| Modifier         | Value   |
|------------------|---------|
| Crop growth rate | 1.3×    |
| Soil fertility   | Very high|
| Weather hazards  | Floods  |
| Water access     | Abundant|

---

## Biome: Voidsoil Expanse

> Barren endgame biome. Sparse resources, extreme conditions, high rewards.

### Identity

| Property     | Value                        |
|--------------|------------------------------|
| Climate      | Arid, hostile                |
| Difficulty   | Advanced                     |
| Terrain      | Flat, cracked earth          |

### Tiles

| Terrain band | Moisture | tileId group        |
|--------------|----------|---------------------|
| 0–2          | Any      | Cracked void-earth  |
| 3–5          | Any      | Ashen soil          |
| 6–7          | Any      | Obsidian formations |

### Resources

| Resource        | Rarity   | Notes                         |
|-----------------|----------|-------------------------------|
| Void crystals   | Uncommon | Premium currency component    |
| Ancient ore     | Rare     | Endgame crafting material     |
| Adapted seeds   | Rare     | High-yield drought crops      |
| Obsidian        | Common   | Decoration / construction     |

### Gameplay Modifiers

| Modifier         | Value     |
|------------------|-----------|
| Crop growth rate | 0.4×      |
| Soil fertility   | Very low  |
| Weather hazards  | Dust storms|
| Water access     | None      |

---

## Biome Comparison Table

| Biome              | Fertility | Difficulty | Unique Output        |
|--------------------|-----------|------------|----------------------|
| Bloomridge         | High      | Beginner   | Starter crops        |
| Stoneveil Highlands| Low       | Medium     | Ores, minerals       |
| Sunfen Delta       | Very high | Medium     | Aquatic crops, clay  |
| Voidsoil Expanse   | Very low  | Advanced   | Void crystals, endgame materials |
