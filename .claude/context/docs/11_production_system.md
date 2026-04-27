# Seedscape — Production System

## Principle

Production buildings convert raw goods into processed goods via deterministic queue-based simulation.

> **Phase status (2026-04):** Phase 4 ships **Mill + Bakery only**. The remaining buildings in the catalogue below (Juicer, Smelter, Sawmill, Press, Dairy, Forge, Refinery, Lab, Kitchen) are defined in `data/buildings.json` but gated behind unlock levels that don't exist yet, or behind input chains that haven't shipped (Smelter needs ore mining; Dairy needs animals from Phase 3.5; etc.). Tier 0 only — upgrade tiers 1–4 are the **Phase 4.5+** target.

---

## Core Chain

```
Raw crop → Mill / Press / Kitchen → Processed good → Market / NPC
```

Example chains:

```
Wheat → [Mill] → Flour → [Bakery] → Bread
Carrot → [Juicer] → Carrot Juice
Corn → [Press] → Corn Oil → [Refinery] → Fuel
Iron Ore → [Smelter] → Iron Ingot → [Forge] → Tools
```

---

## Building Definition

```
BuildingDef {
  id:          Uint16
  name:        string
  tileId:      Uint16       // occupies 1 tile (MVP)
  inputItems:  ItemStack[]  // required inputs per run
  outputItems: ItemStack[]  // produced outputs per run
  cycleTime:   Uint16       // ticks per production cycle
  queueSize:   Uint8        // max pending jobs
  upgradeLevels: Uint8      // number of upgrade tiers
}

ItemStack {
  itemId:   Uint16
  quantity: Uint8
}
```

---

## Queue System

Each building maintains a FIFO production queue.

```
Queue state (per building tile):
  state:     Uint8   // progress within current cycle (0–255)
  queued:    Uint8   // number of pending jobs
  paused:    bit     // in metadata flags
```

### Tick Behavior

Each simulation tick:

1. If queue empty → idle (no progress)
2. If queue has jobs → increment `state`
3. If `state` reaches `cycleTime` → produce output, dequeue job, reset state

### Queue Filling

Player or automation adds input items to building inventory.
When inventory has enough inputs for one run → job auto-enqueues.

---

## Upgrade Scaling

Buildings can be upgraded up to `upgradeLevels` tiers.

| Tier | Cycle time | Queue size | Output bonus |
|------|------------|------------|--------------|
| 0    | 1.0×       | 2          | 1.0×         |
| 1    | 0.85×      | 4          | 1.1×         |
| 2    | 0.70×      | 6          | 1.2×         |
| 3    | 0.55×      | 8          | 1.35×        |
| 4    | 0.40×      | 10         | 1.5×         |

Upgrade cost: coins + materials (defined per building type).

---

## Building Catalogue

> Recipes below describe the **target design**. The "Live in Phase 4?" column reflects what actually ships. Phase 4.5+ unlocks the rest, optionally adjusted (e.g. the Bakery recipe currently simplifies to flour-only because animals — and therefore eggs — are deferred to Phase 3.5).

### Tier 1 — Starter

| Building   | Input         | Output      | Cycle | Live in Phase 4? |
|------------|---------------|-------------|-------|------------------|
| Mill       | 3× Wheat      | 2× Flour    | 30s   | ✅ yes           |
| Juicer     | 5× Carrot     | 2× Juice    | 20s   | ❌ deferred (4.5)|
| Smelter    | 2× Iron Ore   | 1× Ingot    | 60s   | ❌ needs ore mining |
| Sawmill    | 3× Wood       | 2× Planks   | 25s   | ❌ needs woodcutting |

### Tier 2 — Mid Game

| Building   | Input              | Output       | Cycle | Live in Phase 4? |
|------------|--------------------|--------------|-------|------------------|
| Bakery     | 2× Flour, 1× Egg   | 3× Bread     | 45s   | ⚠️ flour-only (egg deferred to 3.5) |
| Press      | 5× Corn            | 2× Corn Oil  | 40s   | ❌ deferred (4.5)|
| Dairy      | 3× Milk            | 2× Cheese    | 60s   | ❌ needs animals (3.5) |
| Forge      | 2× Ingot, 1× Coal  | 1× Tool      | 90s   | ❌ needs Smelter |

### Tier 3 — Advanced

| Building   | Input                    | Output         | Cycle | Live in Phase 4? |
|------------|--------------------------|----------------|-------|------------------|
| Refinery   | 4× Corn Oil              | 3× Fuel        | 120s  | ❌ Phase 5+      |
| Lab        | 2× Void Crystal + 1× Ore | 1× Component   | 180s  | ❌ Phase 5 (Voidsoil biome) |
| Kitchen    | Multiple inputs          | Composite dish | 90s   | ❌ needs people sim (Phase 18) |

---

## Automation (Future)

In later phases, conveyor-style logistics can link buildings:

- Output chest → input chest routing
- Priority rules per item type
- Building networks per farm zone

Not in MVP scope.

---

## Simulation Notes

- Building state lives in `state` + `metadata` tile fields (see [05_data_model.md])
- All production is chunk-local in MVP
- Cross-chunk production chains use shared inventory (player backpack / chests)
- Building simulation runs in the same worker tick as crop simulation
