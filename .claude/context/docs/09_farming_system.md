# Seedscape — Farming System

## Principle

Farming is the core player activity. All crop logic is deterministic simulation: no scripted events, no timers outside tick system.

---

## Core Loop

```
Till → Plant → Water → [Fertilize] → Grow → Harvest → Process → Sell
```

---

## Tile States

A farm tile transitions through:

| tileId group | state (Uint8) | Description          |
|--------------|---------------|----------------------|
| Ground       | 0             | Untilled soil        |
| Farmland     | 0             | Tilled, empty        |
| Crop         | 0             | Seeded               |
| Crop         | 1–6           | Growth stages        |
| Crop         | 7             | Fully grown (ready)  |
| Crop         | 255           | Wilted (dead)        |

---

## Growth Stages

Each crop has 8 stages (0–7).

- Stage 0: seeded (just planted)
- Stages 1–6: intermediate growth
- Stage 7: harvestable

Stage progression is driven by ticks. Each tick evaluates growth conditions per tile.

---

## Growth Formula

```
growthProgress += baseRate * waterModifier * fertilizeModifier * biomeModifier * rngVariance

if growthProgress >= stageThreshold:
  state += 1
  growthProgress = 0
```

### Modifiers

| Factor          | Range     | Source                  |
|-----------------|-----------|-------------------------|
| baseRate        | 1.0       | Crop definition         |
| waterModifier   | 0.5–1.5   | metadata water bits     |
| fertilizeModifier| 0.8–2.0  | metadata fertilizer bits|
| biomeModifier   | 0.4–1.3   | Biome gameplay rule     |
| rngVariance     | 0.9–1.1   | seeded RNG per tile     |

---

## Water System

Water level stored in metadata bits 3–4 (range 0–3).

| Level | Modifier | Decay rule              |
|-------|----------|-------------------------|
| 0     | 0.5×     | Crop wilts after N ticks|
| 1     | 1.0×     | Base rate               |
| 2     | 1.2×     | Well-watered            |
| 3     | 1.5×     | Saturated               |

- Water decays by 1 level per tick cycle (configurable per biome)
- Player action or irrigation building restores level
- Sunfen Delta biome provides auto-water at level 2

---

## Fertilizer System

Fertilizer level stored in metadata bits 0–2 (range 0–7).

| Level | Modifier | Notes                    |
|-------|----------|--------------------------|
| 0     | 0.8×     | Unfertilized             |
| 1–3   | 1.0–1.5× | Standard fertilizer      |
| 4–7   | 1.5–2.0× | Premium / compound feed  |

- Applied by player action or production building
- Does not decay; consumed fully at harvest

---

## Wilt Condition

If water level = 0 for more than `wiltThreshold` ticks:
- state → 255 (wilted)
- Tile becomes farmland again (state = 0, metadata cleared)
- Yields nothing on harvest

Wilt threshold varies by crop type.

---

## Crop Definitions

Each crop is defined by:

```
CropDef {
  id:            Uint16    // crop tileId base
  name:          string    // display name
  baseRate:      Float32   // ticks per stage
  stageThreshold:Float32   // progress needed per stage
  wiltThreshold: Uint16    // ticks before wilt at water 0
  harvestYield:  Uint8     // base item count on harvest
  biomes:        Uint8[]   // valid biome ids
}
```

### Starter Crops (Bloomridge)

| Crop    | Base rate | Stages | Yield | Notes                  |
|---------|-----------|--------|-------|------------------------|
| Wheat   | Fast      | 8      | 3–5   | Universal, versatile   |
| Carrot  | Medium    | 8      | 2–4   | High NPC demand        |
| Corn    | Slow      | 8      | 4–8   | Production chain input |
| Sunflower| Medium   | 8      | 1–2   | Economy crop, oil input|

---

## Harvest

Player interacts with a stage-7 tile:

1. Remove crop tile → restore to farmland (state 0)
2. Add harvested items to player inventory
3. Yield = `harvestYield * fertilizerBonus * biomeBonus`

Yield variance uses seeded RNG (tile position + worldSeed).

---

## Irrigation Buildings

Production buildings that automate watering:

| Building      | Range   | Recharge | Notes                   |
|---------------|---------|----------|-------------------------|
| Well          | 3×3     | 10 ticks | Basic, early game       |
| Sprinkler     | 5×5     | 5 ticks  | Mid-game upgrade        |
| Irrigation    | 8×8     | 2 ticks  | Advanced, high upkeep   |

Buildings simulate inside the chunk tick system.

---

## Animal Integration

Animals produce fertilizer as output:

- Chickens → basic fertilizer
- Cows → rich compost
- Pigs → premium manure

Applied to adjacent farmland tiles automatically or via player action.
