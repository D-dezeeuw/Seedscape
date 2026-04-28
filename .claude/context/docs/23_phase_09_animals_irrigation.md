# Seedscape — Phase 9: Animals & Irrigation

> Restores work cut from Phase 3 (the "3.5" deferred slice). Smallest scope of the next four phases, biggest visible win — a living farm with less manual watering toil and (eventually) a complete bread recipe.
>
> **Phase split:**
>
> - **9.1 (shipped):** data + entity + irrigation + save migration. Animals tick (hunger + produce cycle), Wells/Sprinklers auto-water, animals/eggs/milk persist across reload.
> - **9.2 (shipped):** Shop entries for pens / animals / animal feed. Build tool now places pen tiles (one animal per tile; place adjacent for a fenced pen). FEED_ANIMAL + COLLECT_PRODUCE jobs run autonomously — settlers haul feed from a crate to a hungry animal, then haul produce from the pen back to the deposit crate.
> - **Multi-input building model + Bakery flour+egg recipe:** moved to **Phase 11** alongside the rest of the production catalog. Eggs/milk are tradeable goods (sell at the trader) until then.

## Goal

Two new gameplay layers stacked on the existing farm:

1. **Animals** — chicken (egg) and cow (milk) live in pens on the player's land, produce items on a deterministic cycle, and need feeding.
2. **Irrigation** — Well + Sprinkler buildings auto-water tiles within a radius, removing the need to hand-water a 5×5 farm every cycle.

Restoring the egg ingredient closes the loop: Bakery's recipe in [data/buildings.json](../../../data/buildings.json) goes back to flour + egg → bread without code changes.

## Why now

- Phase 3 shipped without animals/irrigation explicitly to keep the MVP slice tight.
- Bakery's egg ingredient was stubbed to "flour-only" pending animals — restoring it expands production depth for free.
- Sets a pattern (animal entity class) that Phase 12 (settler arrivals) will mirror for new villager spawns.
- Self-contained: no save-version-breaking changes outside the new fields.

## Scope

### Animals as entities

- New entity class `Animal extends LivingEntity` (already stubbed in [src/state/entities/animal.ts](../../../src/state/entities/animal.ts) with `Pet` + `Mount` subclasses — extend it, don't replace).
- Two species: `chicken` and `cow`. Differ only in produce item + cycle length.
- Each animal:
  - Lives in a **pen** (existing `penWorldTileX/Y` field on `Animal`)
  - Wanders within ~3 tiles of its pen when fed; idles when hungry
  - Produces an item every N sim ticks if `hunger ≥ threshold`
  - Has a hunger need that decays like a settler's

### Pen tiles + feed/produce loop

- Tile id range **400–499** reserved for animal-related tiles.
  - 400: Chicken pen
  - 410: Cow pen
- Pen acts like a building from the registry's POV (passive: yes, walkability: blocked).
- Pen has an output buffer (mirroring `BuildingBufferStore`): collected eggs/milk wait there until hauled.
- Animal produce drops directly into the pen's output buffer when the animal cycles.
- New feed item: `animalFeed` (id 720). Sold by the shop; crafted from wheat in Phase 11 (Feed Press building).

### Settler jobs

- New job kinds:
  - `JOB_KIND_FEED_ANIMAL` — settler hauls animalFeed from a crate to a pen, decreasing the animal's hunger
  - `JOB_KIND_COLLECT_PRODUCE` — settler hauls eggs/milk from pen output buffer to a crate
- Both follow the same source/target resolution pattern as Phase 8's `FEED_BUILDING` / `HAUL_OUTPUT` ([src/state/entities/villager_jobs.ts](../../../src/state/entities/villager_jobs.ts)).
- Job emitter scans pens each tick: emits FEED when animal hunger drops below 50%, emits COLLECT when output buffer non-empty.

### Irrigation buildings

- **Well** (tile id 230): 3×3 auto-water radius, recharges every 10 sim ticks. Passive building, no input/output buffer.
- **Sprinkler** (tile id 231): 5×5 auto-water radius, recharges every 5 sim ticks. Higher placement cost.
- Auto-water lives in the sim worker: each tick, irrigation buildings raise tile water level on every farmable tile in radius (clamped to max).
- No settler involvement — irrigation is pure passive automation.

### UI

- Person window: render Animal needs (hunger only for now).
- Building window: pen sections show current animal hunger, last produce, and animal count.
- Tile info: "Chicken Pen — 2/3 hunger, 1 egg ready" style summary.

## Out of scope

- Animal breeding / lifecycle — animals are placed by the player, not born. Reproduction is a later phase.
- Animal AI beyond wander+hunger — no flocking, no fleeing, no "scared by player."
- Mount / Pet behaviors — those classes exist as stubs; Phase 9 leaves mount/pet inert.
- Sprinkler upgrade tiers — fixed 5×5 radius.
- Slaughter / butcher chain — explicit "no" for MVP-tone reasons; revisit after Phase 12.
- Custom feed types — one universal animalFeed item.

## Data shape changes

- **New tile ids:** 230 (Well), 231 (Sprinkler), 400 (Chicken pen), 410 (Cow pen) — register in [data/tiles.json](../../../data/tiles.json) and the building/animal registries.
- **New items:** `animalFeed` (id 720), `egg` (id 710), `milk` (id 711) in [data/items.json](../../../data/items.json), with weight and `defaultSticky: false`.
- **Bakery recipe restoration** — *moved to Phase 11.* The multi-input `BuildingDef` refactor will land alongside Dairy / Forge / Refinery wiring there since those buildings need it too. Phase 9 ships eggs/milk as tradeable goods (sold to NPC orders) only.
- **Save migration:** SAVE_VERSION 10 → 11. Add `animals: AnimalSnapshot[]` to the snapshot. Pen output buffers reuse the existing `BuildingBufferStore` so no separate field needed.

## Open questions (decide before kickoff)

1. **Multi-input buildings** — does Bakery accept two job kinds (one per input), or does FEED_BUILDING take an `inputSlotIdx`? Recommend the second; touches `JobEmitter` ordering.
2. **Animal placement** — does the player buy from the shop (instant appearance in pen) or capture from the wild (later phase)? Recommend shop-purchase for Phase 9.
3. **Feed source** — shop sells feed for ~1c/unit until Feed Press ships in Phase 11.
4. **Wilt restore** — irrigation should reset the wilt timer when wilt ships (still deferred).

## Exit criteria

### 9.1 (shipped)

> A debug-spawned chicken in a pen ticks down its hunger, lays an egg into the pen's output buffer when fed (above the threshold), and stops producing when starved. A debug-placed Well at (X,Y) raises water on every farmable tile in the 3×3 around it on a 10-tick period; Sprinkler does the same on 5×5 every 5 ticks. Save and reload preserves animal hunger + produce progress.

### 9.2 (shipped)

> Place a chicken pen, buy a chicken from the shop, place feed in a crate near the pen. Without further input, watch a settler haul feed → pen, the chicken eat, lay an egg, and another settler haul the egg to a storage crate.

### Phase 11 (further deferred)

> Bakery accepts flour + egg and produces bread.

## Estimated effort

~5–7 days total. **9.1 (shipped)** was the entity + sim + save layer (~2 days). **9.2** is the autonomy + UI layer (~3 days).

## References

- [09_farming_system.md](09_farming_system.md) — water levels, wilt timer (still deferred)
- [11_production_system.md](11_production_system.md) — building queue model that pen output reuses
- [22_pathfinding.md](22_pathfinding.md) — settler job state machine
- [data/buildings.json](../../../data/buildings.json), [data/items.json](../../../data/items.json), [data/tiles.json](../../../data/tiles.json)
