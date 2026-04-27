# Seedscape — Pathfinding & Autonomous Jobs

## Principle

A single A*-on-grid pathfinder runs in a dedicated worker. The main thread mirrors walkability into the worker on chunk load/evict and on building changes. Path requests are async; results are waypoint arrays. The pathfinder is the engine; **jobs** are its first consumer.

> Phase: introduced in Phase 7. Phase 7.5 layered weighted carry + a generic task stack on top of the job state machine. Reusable by any later AI consumer (animals fleeing, enemies, deliveries, possessed avatar nav assist).

---

## Pathfinding Engine

### Algorithm

A* on the tile grid. Binary heap open set, Manhattan heuristic (4-neighbour movement), flat `gScore` / `fScore` / `closed` typed arrays sized to the search bounding box. No per-node objects in the hot loop.

Hybrid extensions (JPS, HPA*, flow fields) are **deferred** until A* alone misses the budget. The architectural reference that motivated this layered approach is [pathfinding.md](../../../pathfinding.md) at repo root.

### Walkability Source

Single source of truth: `isEntityWalkable(tileId)` in [src/world/walkability.ts](../../../src/world/walkability.ts). The worker mirrors a `Uint8Array(1024)` per chunk derived from the same rule — buildings (200..299) and water tiles block, everything else passes. The mirror cannot drift because both sides call the same function.

### Worker Protocol

One dedicated worker. Promote to a pool only if the profiler demands it.

| Message         | Direction      | Payload                                                  |
|-----------------|----------------|----------------------------------------------------------|
| `INIT_GRID`     | main → worker  | `{ chunks: Array<{ key, mask: Uint8Array(1024) }> }`     |
| `UPDATE_CHUNK`  | main → worker  | `{ chunkKey, mask }` — bumps gridVersion                 |
| `INVALIDATE`    | main → worker  | `{ chunkKey }` — chunk evicted                           |
| `PATH_REQUEST`  | main → worker  | `{ requestId, start: [x,y], goal: [x,y], maxNodes }`    |
| `PATH_RESULT`   | worker → main  | `{ requestId, waypoints: Int16Array, gridVersion }`     |

`gridVersion` increments on every grid mutation. Path cache key is `(startIdx, goalIdx, gridVersion)`.

### Main-Thread Client

`pathfinding_client.ts` exposes `requestPath(start, goal): Promise<Int16Array>`. Internally:

- Caches results until gridVersion advances
- Coalesces chunk-dirty events per tick (one batched `UPDATE_CHUNK`)
- Auto-invalidates path cache entries whose gridVersion is stale
- Wires `chunk_manager` load/evict/dirty into the worker

### Budgets

| Metric                              | Target              |
|-------------------------------------|---------------------|
| p95 path cost (≤200-tile open path) | < 2 ms (worker)     |
| Cached path lookup                  | < 0.05 ms (main)    |
| Chunk-mask refresh (1024 tiles)     | < 0.5 ms (main)     |
| Concurrent active path requests     | ≤ 64                |

### Determinism

Same `(start, goal, gridVersion)` → same waypoints. Tie-break by lowest tile index. No `Math.random()`, no clocks. Replay-safe.

---

## Autonomous Jobs

People do useful things by claiming **jobs** from a board. Jobs are produced by world scans, claimed by idle settlers, walked through a small state machine.

### Job Board

Main-thread singleton.

```ts
JobBoard {
  enqueue(job: Job): void
  claim(entityId: number, filter?: JobFilter): Job | null
  complete(jobId: number): void
  cancel(jobId: number, reason: string): void
}

Job {
  id:               Uint32
  kind:             Uint8           // see Job Kinds table below
  source:           [x, y]          // tile to fetch from
  target:           [x, y]          // tile to deliver to
  priority:         Uint8           // higher = sooner
  claimedBy:        Uint32 | 0
  payload:          ItemId | 0      // produce/seed kind, kind-dependent
  lastProgressTime: Float32         // for stale-job sweeper
  holdItems:        ItemId[]?       // (Phase 7.5) sticky list — see Auto-Deposit Injection
}
```

Single-claim mutex. Stale jobs (source vanished, target changed) auto-cancel and re-emit if still relevant.

### Job Kinds

| Kind             | Source                     | Target                        | World effect                          |
|------------------|----------------------------|-------------------------------|---------------------------------------|
| `HAUL_WATER`     | nearest water tile or well | settler's water reserve       | reserve += capacity                   |
| `WATER_CROP`     | settler's water reserve    | thirsty farmland tile         | crop water += 1; reserve -= 1         |
| `HARVEST_CROP`   | ripe crop tile             | nearest storage crate         | crop reset; crate contents += yield   |
| `PLANT_SEED`     | empty tilled tile          | same (single-phase)           | tile becomes crop stage 0             |
| `HAUL_SEED`      | container with seeds       | same (single-phase)           | seed withdrawn into settler carry     |
| `FEED_BUILDING`  | crate with input item      | building's input buffer       | input buffer += cycleInput            |
| `HAUL_OUTPUT`    | building's output buffer   | nearest accepting crate       | crate += output; output buffer -=     |

`PLANT_SEED` and `HAUL_SEED` chain: idle settler with `PLANT_SEED` claimable but no seed → spawns `HAUL_SEED` for itself → next idle re-claims `PLANT_SEED` with the seed in hand.

`FEED_BUILDING` / `HAUL_OUTPUT` (Phase 8) drive the production chain: settlers fill non-passive buildings' input buffers from crates and haul their output to a destination crate. Source/target are emitted as the building tile and resolved at claim time to standing tiles next to the crate (FEED) or the building (HAUL_OUTPUT). Both jobs set `holdItems: [itemId]` so the cargo isn't auto-deposited mid-trip — the same Phase 7.5 plumbing that protects HAUL_SEED's seed.

### Job Emitter

Periodic scan over loaded chunks (default: every ~30 sim ticks):

- `WATER_CROP` — farmland with water below threshold
- `HARVEST_CROP` — crops at max stage
- `PLANT_SEED` — empty tilled tile + at least one container with seeds
- `FEED_BUILDING` — non-passive building with input buffer below 50% of cap
- `HAUL_OUTPUT` — non-passive building with any items in its output buffer
- `HAUL_WATER` / `HAUL_SEED` — emitted lazily by a settler that claimed a job needing the prerequisite

Emitter only re-emits on observable state change. Throttled to avoid storms.

### Settler State Machine

The path-level state machine is unchanged from Phase 7:

```text
idle → requesting_path → walking → acting → (optional: walking → acting) → idle
```

What it drives changed in Phase 7.5 — see Task Stack below. Every `walking` step issues a request through `pathfinding_client`. If no progress for `STUCK_TIMEOUT_SEC`, cancel and drop back to `idle`. A single `replan-once` attempt fires at `REPLAN_THRESHOLD_SEC` before the cancel.

### Task Stack (Phase 7.5)

The controller used to drive a single claimed `Job`. It now drives the **top of a `taskStack: Task[]`** — a generic LIFO queue so sub-tasks can interrupt the current activity:

```ts
type Task =
  | { kind: "job"; jobId: number }
  | { kind: "deposit"; standingTile: {x,y}; cratePos: {x,y} };
```

- The path-level state machine (idle/walking/acting) applies to the **active** task (top of stack).
- Completing a task pops it; the next tick resumes the parent (or claims new work if the stack is empty).
- `claim` pushes a `job` task; `auto-deposit` pushes a `deposit` task.

Today only `deposit` ever gets injected, but the architecture is in place for future interrupts (`eat`, `sleep`, `take_shelter`) without rewriting the state machine.

### Auto-Deposit Injection (Phase 7.5)

Settlers carry weight, not count — see [05_data_model.md](05_data_model.md) for `ItemDef.weight` and `LivingEntity.maxCarryWeight`. When the settler is **≥70% of capacity at idle**, the controller refuses to claim new work and instead pushes a `deposit` task targeting the nearest accepting crate.

The deposit gate computes a per-tick **sticky set** = `union(ItemDef.defaultSticky, claimedJob.holdItems)`. Items in the set survive the deposit. Sources:

- `defaultSticky: true` on `ItemDef` (seeds use this — tiny + always useful for the next `PLANT_SEED`).
- `holdItems: ItemId[]` on `Job` (HAUL_SEED writes `[seedId]` defensively; future Phase 8 hauling jobs will use this for non-default-sticky cargo like flour).

Failure backoff: if a deposit's path request fails (target unreachable), `needsFailureBackoff` throttles the next claim attempt through the same jitter window the board-miss path uses. Without this, a permanently stuck settler would spin the pathfinder once per tick.

### Reserves & Inventory

Per-villager state extends [src/state/entities/villager.ts](../../../src/state/entities/villager.ts) and (for cap fields) [src/state/entities/living_entity.ts](../../../src/state/entities/living_entity.ts):

| Field             | Type                         | Default | Notes                                                  |
|-------------------|------------------------------|---------|--------------------------------------------------------|
| `waterReserve`    | Uint8 (0..5)                 | 0       | Refilled by `HAUL_WATER`                               |
| `carriedItems`    | `Map<ItemId, count>`         | empty   | Filled by harvest / haul, emptied at crate or deposit  |
| `maxCarryWeight`  | Uint16 (deci-units)          | 100     | Per-class — Villager 100, future animals/mounts vary   |
| `maxStackSize`    | Uint8                        | 99      | Per-stack ceiling shared across living entities        |

Persisted in save (SAVE_VERSION 9). `taskStack` is intentionally NOT persisted — settlers re-enter idle on load and the emitter rebuilds the board on first tick; any overweight settler auto-injects a fresh deposit task.

### Storage Containers

Two tile ids:

- `220` — Storage Crate (accepts anything)
- `221` — Seed Dispenser (accepts seeds only; auto-restocks from player inventory)

Per-tile contents stored sparsely as `Map<tileKey, Map<ItemId, count>>`. Containers block walking like other buildings; standing tile is the closest walkable neighbour.

### Building Buffers (Phase 8)

Active (non-passive) buildings — Mill and Bakery today — each carry two sparse buffers in `BuildingBufferStore`:

- **Input buffer** — items waiting to be consumed by a cycle. Settlers drop into it via `FEED_BUILDING`; the player can deposit manually via the building window. The main-thread `autoQueueFromBuffers` tick drains one `cycleInput` per pass into `metadata.queued`, capped at `INPUT_BUFFER_MULTIPLIER` so a full buffer doesn't starve future deliveries.
- **Output buffer** — items produced by finished cycles. The sim's `ProductionEvent` is now redirected here on the main thread instead of the player's inventory; back-pressure: if the buffer is full, overflow is forfeit and XP credits track stored, not produced. Settlers drain it via `HAUL_OUTPUT`; the player can withdraw manually via the building window.

Caps are bounded multiples of `cycleInput / cycleOutput` (`INPUT_BUFFER_MULTIPLIER = 3`, `OUTPUT_BUFFER_MULTIPLIER = 3`). Persisted in save (`SAVE_VERSION 10`); `taskStack` is still not — settlers re-derive their work from the board on first tick after load.

---

## Future Extensions (not in Phase 7)

- **JPS / HPA\* / flow fields** — only if A* p95 exceeds budget under realistic load
- **Time-reservation collision** — for tight corridors when soft-collide stalls visibly
- **Pathfinding worker pool** — when single-worker queue depth pushes p95 over budget
- **Predictive caching** — precompute paths for high-traffic source/target pairs
- **Possessed-avatar nav assist** — auto-step around obstacles while the player holds a movement key

---

## Cross-references

- [14_worker_architecture.md](14_worker_architecture.md) — worker pool conventions, transferable buffers
- [05_data_model.md](05_data_model.md) — entity / chunk formats
- [09_farming_system.md](09_farming_system.md) — crop water + harvest rules that jobs read/write
- [18_people_system.md](18_people_system.md) — full people sim (the present system is its precursor)
- [pathfinding.md](../../../pathfinding.md) — original architectural reference at repo root
