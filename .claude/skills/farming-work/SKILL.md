---
name: farming-work
description: Use when implementing or modifying crop logic — growth stages, water/fertilizer modifiers, wilt, harvest, irrigation buildings, or any farming gameplay mechanic.
---

# Farming Work

Crops are deterministic state machines on tile-grid. All logic runs in the simulation worker.

## Mandatory Reading

1. [farming system](../../context/docs/09_farming_system.md) — crop lifecycle, formulas
2. [world simulation](../../context/docs/03_world_simulation.md) — sim rules
3. [data model](../../context/docs/05_data_model.md) — tile state/metadata layout

## Hard Rules

- **Crop data is in `data/crops.json`.** Do not hardcode crop definitions in TypeScript.
- **Growth is tick-driven.** No timers, no `setTimeout`. Progress increments on each sim tick.
- **8 stages (0–7).** Stage 7 = harvestable. State 255 = wilted.
- **All RNG seeded.** Yield variance and growth jitter use `hash(worldSeed, tileX, tileY)`.
- **Wilt is reversible only by re-tilling.** Once `state = 255`, the tile resets to farmland on harvest.

## Tile Layout for Crops

```
tileId   (Uint16): crop type id (100–199 range — see data/tiles.json)
state    (Uint8):  growth stage 0–7, or 255 (wilted)
metadata (Uint8):  bits 0–2 = fertilizer (0–7)
                   bits 3–4 = water (0–3)
                   bits 5–7 = seed variant (0–7)
```

## Growth Formula

```
growthProgress += baseRate
                * waterModifier
                * fertilizeModifier
                * biomeModifier
                * rngVariance

if growthProgress >= stageThreshold:
  state += 1
  growthProgress = 0
```

Modifier ranges and source per [farming doc §Modifiers](../../context/docs/09_farming_system.md).

## Water Decay

Water level (metadata bits 3–4) decays by 1 per `waterDecayInterval` ticks. If level reaches 0 and stays there for `wiltThreshold` ticks → state becomes 255.

## Adding a Crop

Follow [add-crop playbook](../../context/playbooks/add-crop.md).

## Common Pitfalls

- Hardcoded crop stats in code (should be in JSON).
- Using `Math.random()` for yield (must be seeded).
- Forgetting to clear metadata bits on harvest.
- Storing growthProgress in tile data — it's a sim-worker-local accumulator, not persistent state.
