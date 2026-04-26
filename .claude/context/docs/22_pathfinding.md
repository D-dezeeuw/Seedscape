# Seedscape — Pathfinding & Autonomous Jobs

## Principle

A single A*-on-grid pathfinder runs in a dedicated worker. The main thread mirrors walkability into the worker on chunk load/evict and on building changes. Path requests are async; results are waypoint arrays. The pathfinder is the engine; **jobs** are its first consumer.

> Phase: introduced in Phase 7. Reusable by any later AI consumer (animals fleeing, enemies, deliveries, possessed avatar nav assist).

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
  id:        Uint32
  kind:      Uint8       // HAUL_WATER | WATER_CROP | HARVEST_CROP
  source:    [x, y]      // tile to fetch from
  target:    [x, y]      // tile to deliver to
  priority:  Uint8       // higher = sooner
  claimedBy: Uint32 | 0
  payload:   ItemId | 0  // optional resource type
}
```

Single-claim mutex. Stale jobs (source vanished, target changed) auto-cancel and re-emit if still relevant.

### Job Kinds (initial set)

| Kind           | Source                     | Target                        | World effect                       |
|----------------|----------------------------|-------------------------------|------------------------------------|
| `HAUL_WATER`   | nearest water tile or well | settler's water reserve       | reserve += capacity                |
| `WATER_CROP`   | settler's water reserve    | thirsty farmland tile         | crop water += 1; reserve -= 1      |
| `HARVEST_CROP` | ripe crop tile             | nearest storage crate         | crop reset; crate contents += yield|

### Job Emitter

Periodic scan over loaded chunks (default: every ~30 sim ticks):

- `WATER_CROP` — farmland with water below threshold
- `HARVEST_CROP` — crops at max stage
- `HAUL_WATER` — emitted lazily, only when a settler claiming a `WATER_CROP` is dry

Emitter only re-emits on observable state change. Throttled to avoid storms.

### Settler State Machine

```text
idle → claim → move_to_source → act_at_source → move_to_target → act_at_target → complete → idle
```

Every `move_*` step issues a request through `pathfinding_client`. If no progress for N ticks (blocked by another entity, building placed): cancel job, return to `idle`, drop job back to board.

### Reserves

Per-villager state extends [src/state/entities/villager.ts](../../../src/state/entities/villager.ts):

| Field          | Type             | Default | Notes                                  |
|----------------|------------------|---------|----------------------------------------|
| `waterReserve` | Uint8 (0..5)     | 0       | Refilled by `HAUL_WATER`               |
| `inventory`    | ItemStack[≤10]   | []      | Filled by `HARVEST_CROP`, emptied at crate |

Persisted in save (SAVE_VERSION bump on phase ship).

### Storage Crate

New tile id 220. Per-tile contents stored sparsely as `Map<tileKey, ItemStack[]>` — crates are rare, sparse map beats per-chunk array. Operations: `deposit`, `withdraw`, `capacity`. Crates block walking like other buildings.

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
