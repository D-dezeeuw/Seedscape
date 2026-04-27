# Seedscape Docs — Index

Numbered reference. Pull targeted docs per task — do not load all at once.

> **Where to look for what shipped:** Phase 6 (possession) is described in [21_vision_and_story.md](21_vision_and_story.md) — there's no standalone systems doc, the implementation is small enough to read directly in `src/state/possession_controller.ts` + `src/input/`. Phase 7 (pathfinding + autonomous jobs) and Phase 7.5 (weighted carry + task stack) live in [22_pathfinding.md](22_pathfinding.md). Carry-cap fields and `Job.holdItems` are in [05_data_model.md](05_data_model.md).

## Orientation

- [00_overview.md](00_overview.md) — Technical vision, pillars, world structure
- [21_vision_and_story.md](21_vision_and_story.md) — Player vision, story, dual-control (god + possession)
- [01_game_design.md](01_game_design.md) — Player-facing rules
- [17_mvp_scope.md](17_mvp_scope.md) — What's in / out of first playable
- [19_roadmap.md](19_roadmap.md) — Phase plan + exit criteria
- [20_implementation_kickoff.md](20_implementation_kickoff.md) — Toolchain, bootstrap sequence, "Phase 1 ready" checklist

## Architecture

- [02_engine_spec.md](02_engine_spec.md) — Engine contract
- [03_world_simulation.md](03_world_simulation.md) — Deterministic sim rules
- [04_rendering_pipeline.md](04_rendering_pipeline.md) — GPU pipeline overview

## Data & Memory

- [05_data_model.md](05_data_model.md) — Chunk / tile / entity formats
- [06_memory_performance.md](06_memory_performance.md) — Budgets + perf targets

## World

- [07_world_generation.md](07_world_generation.md) — Procedural pipeline
- [08_biomes.md](08_biomes.md) — Biome rules *(content → `data/biomes.json`)*

## Gameplay Systems

- [09_farming_system.md](09_farming_system.md) — Crop lifecycle *(content → `data/crops.json`)*
- [10_economy_system.md](10_economy_system.md) — Pricing + NPC orders *(content → `data/prices.json`)*
- [11_production_system.md](11_production_system.md) — Buildings + queues *(content → `data/buildings.json`)*
- [12_progression_system.md](12_progression_system.md) — XP + unlocks *(content → `data/unlocks.json`)*

## Engine Internals

- [13_chunk_lifecycle.md](13_chunk_lifecycle.md) — Chunk state machine
- [14_worker_architecture.md](14_worker_architecture.md) — Worker pool + messages
- [15_rendering_shaders.md](15_rendering_shaders.md) — GLSL contract
- [22_pathfinding.md](22_pathfinding.md) — Pathfinding engine + autonomous job system + task stack (Phase 7.5)

## Phase Plans (next four)

- [23_phase_09_animals_irrigation.md](23_phase_09_animals_irrigation.md) — Animals + Well/Sprinkler (deferred 3.5)
- [24_phase_10_people_simulation.md](24_phase_10_people_simulation.md) — Needs + sleep + eat + day cycle
- [25_phase_11_dynamic_economy.md](25_phase_11_dynamic_economy.md) — Dynamic pricing + full production catalog (deferred 4.5)
- [26_phase_12_settler_arrival.md](26_phase_12_settler_arrival.md) — Arrival mechanic + backstories + relationships

## Future

- [16_networking_model.md](16_networking_model.md) — Multiplayer design
- [18_people_system.md](18_people_system.md) — Autonomous people sim (needs, day cycle, memory)

---

## Doc vs Data

Where a doc has a table marked *(content → `data/X.json`)*, the JSON is authoritative. The doc explains the schema and rules; the JSON holds the values.

Edit JSON for content changes. Edit docs only when the *rules* change.

---

## Archive

Original source drafts that this doc set was generated from live in [../archive/](../archive/README.md). Kept for traceability — not authoritative.
