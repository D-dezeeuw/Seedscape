# Seedscape — Farming System

## Principle

Farming is the core player activity. All crop logic is deterministic simulation: no scripted events, no timers outside tick system.

---

## Core Loop

```
Till → Plant → Water → [Fertilize] → Grow → Harvest → Process → Sell
```

---

## Phase Status

The farming loop shipped in Phase 3 with deliberate cuts. Items still on the future-work list:

- **Wilt timer** — the per-tile dry-tick counter that drives `state → 255`. The crop metadata bit layout reserves bits 5–7 for *seed variant*, leaving no room for a counter; reuse those bits or repurpose them when seed variants ship. Until then, water level can hit 0 and crops simply pause growth — they don't die.
- **Seed variants** (metadata bits 5–7) — reserved, not implemented. Variant logic is a Phase 3.5+ task.
- **Animals + their fertilizer outputs** — deferred to Phase 3.5. The Bakery's egg ingredient is currently substituted with flour-only because of this.
- **Irrigation buildings** (Well, Sprinkler) — deferred to Phase 3.5. The doc describes the target design.
- **Sunfen Delta auto-water** — deferred with the Sunfen biome itself (Phase 5).

---

## Tile States

A farm tile transitions through:

| tileId group | state (Uint8) | Description          | Phase |
|--------------|---------------|----------------------|-------|
| Ground       | 0             | Untilled soil        | live  |
| Farmland     | 0             | Tilled, empty        | live  |
| Crop         | 0             | Seeded               | live  |
| Crop         | 1–6           | Growth stages        | live  |
| Crop         | 7             | Fully grown (ready)  | live  |
| Crop         | 255           | Wilted (dead)        | reserved — wilt timer is **deferred** (see Wilt Condition) |

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

> **⚠️ Deferred (post-Phase 3).** Specified here as the target rule. Today crops at water=0 simply pause growth (`growthInterval` gate). The dry-tick counter that triggers wilt isn't implemented because metadata bits 5–7 are reserved for seed variants — there's no counter slot until that decision is revisited.

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

> **⚠️ Deferred to Phase 3.5.** No animal entity classes ship in Phase 3. Tile range 400–499 is reserved for them.

Animals produce fertilizer as output:

- Chickens → basic fertilizer
- Cows → rich compost
- Pigs → premium manure

Applied to adjacent farmland tiles automatically or via player action.

---

## Settler Farming Autonomy (Phase 7+)

Phase 7 added autonomous settlers that run the farming loop themselves: water, plant, harvest. Phase 7.5 added weighted carry on top so harvests now require multiple round-trips to crates instead of one big haul.

- Watering: settlers refill from a water source (HAUL_WATER) and drain into thirsty crops (WATER_CROP).
- Planting: empty tilled tiles emit PLANT_SEED jobs; settlers fetch from a Seed Dispenser via HAUL_SEED.
- Harvesting: ripe tiles emit HARVEST_CROP; the settler delivers yield to the nearest crate that accepts it.

Carry weight (Phase 7.5) means a 30-wheat field becomes ~3 round-trips, not one. Crates are now *infrastructure* — a farm without enough storage will see settlers loop indefinitely. See [22_pathfinding.md](22_pathfinding.md) for the engine and [05_data_model.md](05_data_model.md) for the inventory cap fields.
