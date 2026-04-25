# Seedscape

Infinite, procedural, tile-based farming simulation built as a GPU-driven world. Browser-based (WebGL2 + Web Workers). The starting biome is **Bloomridge**.

> Status: greenfield. Design docs exist; code does not. Implementation begins with the rendering prototype (Phase 1).

---

## Tech Stack

- **Rendering:** WebGL2 (instanced draws, single atlas texture)
- **Simulation:** Web Workers (deterministic, message-passing)
- **Persistence:** IndexedDB (client-side, MVP)
- **Server (future):** Node.js (authoritative simulation, multiplayer)
- **Language:** TypeScript (strict mode)

---

## Folder Layout (planned)

```text
client/
  core/          # bootstrapping, main loop
  rendering/     # WebGL pipeline, shaders, atlas
  world/         # chunk system, generation, LRU cache
  workers/       # generation, simulation, mesh, IO
  input/         # mouse, keyboard, touch
  state/         # player, inventory, progression
  net/           # client-side network layer (future)
  ui/            # HUD, panels, menus

server/          # Node.js authoritative sim (future)

shared/
  world/         # deterministic generation
  simulation/    # crop/building tick logic
  constants/     # tile ids, enums, magic numbers
  utils/         # seeded RNG, hashing, math

data/            # JSON game content (see data/README.md)
```

---

## Core Conventions

- **Typed arrays only** in chunk/tile data. Never `{}` or `[]` per tile.
- **No GC in hot paths** (sim tick, render frame). Pre-allocate, transfer, reuse.
- **Deterministic workers**: no `Math.random()`, no `Date.now()` in simulation. Seeded RNG only.
- **Chunks are atomic**: 32×32 tiles. Generation, sim, render, save all chunk-granular.
- **Delta-only worker output**: simulation returns changed tile indices, not whole arrays.
- **Single atlas, single shader**: no per-tile shader variants.

---

## Where to Find Things

### Design docs — `.claude/context/docs/`

Numbered reference. Read targeted docs based on task; do not pull all 19.

| Working on…               | Read these                 |
|---------------------------|----------------------------|
| Anything (orientation)    | 00, 17 (MVP), 19 (roadmap) |
| Project setup / bootstrap | 20                         |
| Rendering / shaders       | 04, 15                     |
| Chunks / data model       | 05, 06, 13                 |
| Workers / threading       | 14                         |
| World gen / biomes        | 07, 08                     |
| Farming                   | 09, 03                     |
| Economy                   | 10                         |
| Production buildings      | 11                         |
| Progression / unlocks     | 12                         |
| Networking (future)       | 16                         |
| People sim (future)       | 18                         |

Full index: [.claude/context/docs/INDEX.md](.claude/context/docs/INDEX.md)

### Game content — `data/`

JSON files are the source of truth for crops, buildings, biomes, unlocks, prices. **Edit JSON, not the doc tables.** See [data/README.md](data/README.md).

### Implementation playbooks — `.claude/context/playbooks/`

Short ordered checklists for cross-cutting tasks (add a tile type, add a worker task, wire a new system).

### Skills — `.claude/skills/`

Auto-trigger on intent. Each skill loads only the docs needed for its domain.

---

## Implementation Phase

Currently: **pre-Phase 1**. See [.claude/context/docs/19_roadmap.md](.claude/context/docs/19_roadmap.md) for phase exit criteria.

Until Phase 1 lands, all work is documentation/scaffolding. Do not implement features outside the current phase scope.

**Before writing any code**, follow [20_implementation_kickoff.md](.claude/context/docs/20_implementation_kickoff.md) — it locks toolchain decisions and defines what "Phase 1 ready" means. The `bootstrap` skill walks through it.

---

## Build & Run

Toolchain locked: Vite + TypeScript (strict) + Vitest + Biome. Setup steps in [20_implementation_kickoff.md](.claude/context/docs/20_implementation_kickoff.md).

```bash
npm run dev      # Vite dev server with HMR
npm run build    # typecheck + production bundle
npm test         # run vitest suite
npm run lint     # biome check
npm run format   # biome format --write
```

> Commands above are valid only after bootstrap completes. Pre-bootstrap, none of these scripts exist.
