# Seedscape — Development Roadmap

## Structure

5 phases from rendering prototype to live expansion. Each phase builds on the previous and ends with a playable milestone.

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

**Duration:** Ongoing

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

## Milestone Summary

| Phase | Duration  | Milestone                              |
|-------|-----------|----------------------------------------|
| 1     | ~1 week   | 60fps instanced tile renderer          |
| 2     | ~2 weeks  | Infinite streaming procedural world    |
| 3     | ~2 weeks  | Playable farm loop + save system       |
| 4     | ~3 weeks  | Full economy + production chains       |
| 5     | Ongoing   | Biome expansion + multiplayer          |

---

## Risk Register

| Risk                            | Mitigation                                   |
|---------------------------------|----------------------------------------------|
| WebGL performance ceiling       | Phase 1 benchmarks gate all further work     |
| Worker message overhead         | Transferable buffers; delta-only sim output  |
| Economy balancing               | Tunable decay/multiplier constants           |
| Chunk sync complexity           | Single-player first; networking layered on   |
| Scope creep                     | MVP scope doc ([17_mvp_scope.md]) is binding |
