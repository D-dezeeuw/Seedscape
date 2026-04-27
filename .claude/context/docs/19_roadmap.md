# Seedscape — Development Roadmap

## Structure

7+ phases from rendering prototype to live expansion. Each phase builds on the previous and ends with a playable milestone. Phases 6 and 7 were inserted after the original 1–5 outline once the player-facing avatar (possession) and AI-driven settlers became scope; they sit logically before the broader Phase 5 expansion work resumes.

---

## Phase 1 — Rendering Prototype

**Goal:** Prove the WebGL engine can render a large tile world at 60fps.

**Duration:** ~1 week

### Deliverables

- WebGL2 canvas + instanced quad rendering
- Texture atlas sampling
- Camera pan + zoom
- Static chunk of 32×32 hardcoded tiles
- Performance baseline: 200K tiles @ 60fps

### Exit Criteria

> A grid of tiles renders at 60fps. Camera moves smoothly. Atlas sprites show correctly.

---

## Phase 2 — Chunk System

**Goal:** Replace static data with a streaming, procedural world.

**Duration:** ~1–2 weeks

### Deliverables

- Chunk typed array model (tileId / state / metadata)
- World generation worker (Simplex noise → Bloomridge tiles)
- LRU chunk cache (64+ chunks)
- Dynamic chunk load/evict on camera movement
- Dirty flag → GPU buffer rebuild
- Chunk seed system (deterministic generation)

### Exit Criteria

> Camera pans across an infinite procedurally generated Bloomridge world. No tile pop-in. Memory stable.

---

## Phase 3 — Farming Loop

**Goal:** Core gameplay loop playable end-to-end.

**Duration:** ~2 weeks

### Deliverables

- Tile interaction: till, plant, water, harvest
- Crop simulation worker (growth stages, wilt)
- Inventory system (player backpack)
- Save / load (IndexedDB persistence)
- Basic UI: inventory panel, tile info, coin + XP display
- Carrot + Corn crops
- Animals: chicken (egg), cow (milk) — basic feeding cycle
- Well building (auto-water 3×3)
- Sprinkler building (auto-water 5×5)
- Achievement system (cosmetic milestones)
- Building upgrade tier 1

### Exit Criteria

> Player can farm wheat from seed to harvest, accumulate inventory, save and reload without data loss.

---

## Phase 4 — Economy + Production

**Goal:** Full production chain and dynamic economy.

**Duration:** ~2–3 weeks

### Deliverables

- Mill, Bakery, Juicer, Smelter, Press, Dairy, Forge
- Queue-based building simulation
- NPC order system (3–5 NPCs, rotating orders)
- Dynamic supply/demand pricing
- Inflation controls (sinks, price floor/ceiling)
- Coin flow complete (earn → spend → earn cycle)
- Expansion unlock (buy new farm plots with coins)
- Lighting system (optional, post-MVP polish)
- Particle effects (harvest, building activity)
- Automation: conveyor draft / chest routing (if time)

### Exit Criteria

> Player runs a multi-building production chain (Wheat → Flour → Bread), fulfills NPC orders, earns coins, and unlocks new farm area. Economy responds to player behavior.

---

## Phase 5 — Expansion + Polish

**Goal:** World breadth, biome diversity, multiplayer foundation.

**Duration:** Ongoing — partially landed (cleanup + small features); biome breadth and multiplayer still pending.

### Deliverables

- Stoneveil Highlands biome (minerals, frost hazard)
- Sunfen Delta biome (aquatic crops, flood hazard)
- Voidsoil Expanse biome (endgame resources)
- Biome transition zones (noise-based blending)
- Advanced production chains (Tier 3 buildings)
- Endgame unlocks (Lab, Refinery, void recipes)
- Multiplayer architecture (WebSocket + server authority)
- Chunk delta sync protocol
- NPC order multiplayer balancing
- Performance audit (target: 500K tiles @ 60fps)
- Mobile / touch input layer

### Exit Criteria

> Player can explore all 4 biomes, run endgame production chains, and (optionally) play with another player in the same world.

---

## Phase 6 — Possession & Avatar Control

**Goal:** Make the world dual-controllable. The player can possess any settler and pilot them directly with 4-cardinal movement, while every non-possessed settler keeps running its autonomy. Establishes the "god + avatar" framing described in [21_vision_and_story.md](21_vision_and_story.md).

**Duration:** ~2 weeks (shipped)

### Deliverables

- `PossessionController` — single-occupant state container
- Per-class `availableActions` on `LivingEntity` (subclasses pick which tools are usable while possessed)
- Camera follow mode with dead-zone + drag-pause
- `InputRouter` for 4-cardinal movement keys
- Faced-tile reticle + canvas-click suppression while possessed
- `Entity.facedTile` helper
- Action key (E) fires the active tool against the faced tile
- Avatar movement + AI pause for the possessed settler
- ESC priority routing — windows close first, possession exits last
- Save/load round-trip of possession state
- Possessed-ring visual + FAB (floating action button)

### Exit Criteria

> Click a settler → press P (or the FAB) → the camera locks on, WASD moves them, E uses the equipped tool on the faced tile. ESC unwinds windows then drops possession. Save/reload while possessed restores both the avatar and the camera mode. Other settlers keep working autonomously throughout.

---

## Phase 7 — Pathfinding & Autonomous Jobs

**Goal:** Settlers walk on real paths and do useful work — water crops, plant seeds, harvest crops — autonomously. Pathfinding becomes a reusable engine for any future AI movement.

**Duration:** ~2 weeks (shipped)

### Deliverables

- A*-on-grid pathfinder in a dedicated worker (single worker, not a pool)
- Walkability mirroring + chunk delta protocol, gridVersion-keyed cache
- Pathfinding client with promise-based requests
- Storage crate + seed dispenser container tiles, sparse contents store
- Villager water reserve + item inventory
- Job board with single-claim mutex
- Job emitters: HaulWater, WaterCrop, Harvest, PlantSeed, HaulSeed
- Job state machine on Villager (idle → claim → walk → act → complete)
- Hash-of-id stagger to spread spawn-burst claim attempts
- Time-decayed soft-collision relaxation + replan-once-before-cancel for stuck settlers
- Sim keep-set so off-screen settlers continue ticking without their chunks getting evicted
- Dutch name generator + per-settler memory ring buffer for player-visible action history
- Debug viz: selected settler's waypoints + current job in Person window

### Exit Criteria

> A spawned settler walks to a water tile, fills up, walks to a thirsty crop, waters it, then walks to a ripe crop, harvests it, and deposits in the nearest crate — autonomously. Empty tilled tiles get planted from a stocked seed dispenser. Building placement mid-route triggers replan. 150 settlers maintain ≥60fps with active job mix. Pathfinding stays off the main thread.

See [22_pathfinding.md](22_pathfinding.md) for the engine reference.

---

## Phase 8 — Production Hauling

**Goal:** Settlers run the production chain end-to-end. They haul wheat from a crate to a Mill, the Mill produces flour into its own output buffer, and a settler hauls that flour to a destination crate (or to the Bakery, whose output another settler hauls onward). The player no longer has to manually feed buildings.

**Duration:** ~3–5 days (shipped)

### Deliverables

- `BuildingBufferStore` — sparse per-building input + output buffers, mirroring `CrateStore`'s shape
- Main-thread `autoQueueFromBuffers` tick: drains input buffer → `metadata.queued` so the sim worker stays unchanged
- `ProductionEvent` handler redirected: output goes to the building's output buffer, not the player's inventory (back-pressure halts production when full)
- Two new job kinds: `FEED_BUILDING` (kind 6), `HAUL_OUTPUT` (kind 7)
- `JobEmitter` extended: emits `FEED_BUILDING` when input < 50% of cap, `HAUL_OUTPUT` when output buffer non-empty
- Settler controller wires both kinds: claim-time source/target resolution (mirroring HARVEST_CROP), `actAtSource` + `actAtTarget` cases, two new memory event types (`FED_BUILDING`, `HAULED_OUTPUT`)
- Building window UI: status (cycle / queued / buffer levels), manual deposit input, manual withdraw output — keeps the no-settlers play path working
- `SAVE_VERSION 9 → 10` with the new buffer snapshot

### Exit Criteria

> Place a Mill near a wheat-stocked crate and an empty crate. Spawn a settler. Without any player input, watch the settler haul wheat → mill → cycle → flour → second crate. Repeat with Mill → Bakery → bread → crate to verify the multi-building chain. With no settlers, the building window's manual deposit/withdraw buttons keep production runnable.

---

## Phase 7.5 — Weighted Carry & Task Injection

**Goal:** Make settler inventories physical (weight, not count) and give the controller a generic mechanism for "do X before Y" sub-tasks. The first consumer is auto-deposit when overweight; future consumers are mid-job interrupts (eat, sleep, take shelter) and Phase 8 production hauling.

**Duration:** ~3 days (shipped)

### Deliverables

- `ItemDef.weight` (deci-units, integer math) + `ItemDef.defaultSticky` flag
- Carry caps moved to `LivingEntity` instance fields (`maxCarryWeight`, `maxStackSize=99`) so each entity class tunes its own budget
- Weight-based `pickup()` clamping (per-stack ceiling AND remaining weight)
- Controller refactored around a `taskStack: Task[]` (LIFO injection, single active task)
- `deposit` task auto-injected when a settler is ≥70% capacity at idle
- `Job.holdItems` — per-job sticky list, OR'd with `defaultSticky` to form the deposit-gate exemption set
- Failure backoff to throttle pathfinder spam when a deposit target is unreachable
- Person window: weight bar, task hint ("walking · depositing"), item names

### Exit Criteria

> A settler carrying 8 wheat (80% of cap) auto-injects a deposit task at the next idle, walks to the nearest accepting crate, dumps, and resumes work — without manual intervention. Seeds and any item declared in an active job's `holdItems` survive the deposit. The mechanism is data-driven (no item-specific code in the controller).

---

## Milestone Summary

| Phase | Duration   | Milestone                              |
|-------|------------|----------------------------------------|
| 1     | ~1 week    | 60fps instanced tile renderer          |
| 2     | ~2 weeks   | Infinite streaming procedural world    |
| 3     | ~2 weeks   | Playable farm loop + save system       |
| 4     | ~3 weeks   | Full economy + production chains       |
| 5     | Ongoing    | Biome expansion + multiplayer          |
| 6     | ~2 weeks   | Possession + avatar control            |
| 7     | ~2 weeks   | Autonomous settlers + pathfinding      |
| 7.5   | ~3 days    | Weighted carry + task injection        |
| 8     | ~3–5 days  | Settler-driven production hauling      |

---

## Risk Register

| Risk                            | Mitigation                                   |
|---------------------------------|----------------------------------------------|
| WebGL performance ceiling       | Phase 1 benchmarks gate all further work     |
| Worker message overhead         | Transferable buffers; delta-only sim output  |
| Economy balancing               | Tunable decay/multiplier constants           |
| Chunk sync complexity           | Single-player first; networking layered on   |
| Scope creep                     | MVP scope doc ([17_mvp_scope.md]) is binding |
