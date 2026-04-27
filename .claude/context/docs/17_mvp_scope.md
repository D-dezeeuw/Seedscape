# Seedscape — MVP Scope

## Definition

> MVP = first playable Seedscape. A player can load the world, farm a crop, process it, and sell it. The world renders correctly and performs at 60fps.

---

## Must Exist for First Playable

### Rendering
- [x] WebGL2 canvas with instanced tile rendering
- [x] Texture atlas bound and sampled correctly
- [x] Camera pan (mouse drag / WASD)
- [x] Chunk-based rendering (visible chunks only)
- [x] Dirty chunk GPU buffer rebuild

### World
- [x] World seed system
- [x] Chunk generation (Bloomridge biome only)
- [x] Terrain + moisture noise → tile assignment
- [x] Chunk LRU cache (≥64 chunks)

### Farming
- [x] Till tile (ground → farmland)
- [x] Plant seed (farmland → crop stage 0)
- [x] Water tile (manual)
- [x] Crop growth simulation (stage 0→7)
- [x] Harvest (stage 7 → items in inventory)
- [x] Wilt condition (water = 0 too long)

### Production
- [x] Mill building (Wheat → Flour)
- [x] Bakery building (Flour → Bread)
- [x] Queue-based simulation for buildings

### Economy
- [x] Basic NPC order system (1–2 NPCs)
- [x] Fixed base prices (no dynamic demand in MVP)
- [x] Coin balance tracked
- [x] Sell to NPC order → receive coins

### Progression
- [x] XP earned on harvest + sell
- [x] Level up to level 10
- [x] Unlock: Carrot, Corn, Juicer by level 5

### Inventory
- [x] Player backpack (flat item list)
- [x] Item counts displayed in UI
- [x] Add / remove items correctly

### UI
- [x] Tile info panel (click tile → see type/state)
- [x] Inventory panel
- [x] Coin + XP display
- [x] NPC order list

### Workers
- [x] Generation worker (1)
- [x] Simulation worker (1)
- [x] IO worker (1, IndexedDB)

---

## Explicitly Excluded from MVP

The "Phase" column reflects where each item is now scheduled — the original numbering shifted as work progressed. See `memory/project_phase_deferred.md` for the per-phase deferred list.

| Feature                              | Phase            |
|--------------------------------------|------------------|
| Dynamic economy / pricing            | Phase 4.5 (deferred from 4) |
| Stoneveil / Sunfen / Voidsoil biomes | Phase 5          |
| Animals (chicken, cow)               | Phase 3.5 (deferred from 3) |
| Multiplayer                          | Phase 5+         |
| Automation / conveyors               | Phase 4+ (no fixed slot) |
| Lighting system                      | Polish — no fixed slot |
| Particle effects                     | Polish — no fixed slot |
| Achievements                         | Not yet scheduled — never shipped, originally Phase 3 |
| Building upgrade tiers (1–4)         | Phase 4.5+       |
| Well + Sprinkler                     | Phase 3.5 (deferred from 3) |
| Advanced production chains           | Phase 4.5+       |
| Wilt timer                           | Deferred — see [09_farming_system.md](09_farming_system.md) |
| Seed variants (metadata bits 5–7)    | Reserved, no impl yet |

---

## First 4-Week Build Plan

### Week 1 — Rendering Prototype
- [ ] Canvas setup, WebGL2 context
- [ ] Shared quad geometry
- [ ] Instance buffer upload
- [ ] Vertex + fragment shader (atlas UV)
- [ ] Camera transform + pan
- [ ] Static chunk render (hardcoded tile data)

### Week 2 — Chunk System
- [ ] Chunk data model (typed arrays)
- [ ] World generation worker (noise → tiles)
- [ ] LRU chunk cache
- [ ] Dynamic chunk load on camera move
- [ ] Dirty flag + GPU buffer rebuild

### Week 3 — Farming Loop
- [ ] Tile interaction (till, plant, water, harvest)
- [ ] Simulation worker (crop growth tick)
- [ ] Inventory system (player backpack)
- [ ] Save / load (IndexedDB)
- [ ] Basic UI: inventory + tile info

### Week 4 — Economy + Polish
- [ ] Mill + Bakery buildings
- [ ] NPC order system (2 NPCs, fixed prices)
- [ ] Coin + XP system
- [ ] Level 1–10 unlock tree
- [ ] Performance pass (target: 60fps, 100K tiles)
- [ ] Bug fix + playtest

---

## Beyond MVP — Already Shipped

Work that landed after the original MVP was reached, in the order it shipped:

- **Phase 6** — possession + avatar control (player can pilot any settler)
- **Phase 7** — pathfinding worker + autonomous settler jobs (water / plant / harvest, named identities, action memory)
- **Phase 7.5** — weighted carry + task injection (overweight settlers auto-deposit; foundation for Phase 8 hauling and Phase 18 needs)

These are scope **additions** to MVP, not regressions of it — the playable loop in the section below still works on a fresh save.

---

## Definition of Playable Seedscape

A session is considered playable when a player can complete this loop without error:

1. Open browser → world loads
2. Pan camera across Bloomridge terrain
3. Till 5 tiles → plant wheat → water → wait for growth
4. Harvest wheat → see items in inventory
5. Place Mill → convert wheat to flour
6. Sell flour to NPC order → receive coins
7. Level up → unlock Carrot seeds
8. Save game → reload → state preserved
