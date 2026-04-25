# Seedscape — Chunk Lifecycle

## Principle

The chunk is the atomic unit. All systems — generation, simulation, rendering, persistence — operate at chunk granularity.

---

## State Machine

```
[ABSENT] → [REQUESTED] → [GENERATING] → [READY] → [ACTIVE] → [EVICTING] → [ABSENT]
                                                        ↕
                                                   [SIMULATING]
                                                        ↕
                                                   [RENDERING]
```

---

## States Defined

| State       | Description                                              |
|-------------|----------------------------------------------------------|
| ABSENT      | Not in memory. May exist on disk.                        |
| REQUESTED   | Camera/sim demanded it; queued for load/generate         |
| GENERATING  | Worker running world generation                          |
| READY       | Data in CPU memory; awaiting activation                  |
| ACTIVE      | In simulation range and/or render range                  |
| SIMULATING  | Currently being ticked by worker (sub-state of ACTIVE)   |
| RENDERING   | GPU buffer current; included in draw calls               |
| EVICTING    | Marked for removal; writing dirty data to disk           |

---

## Load Path

### Cache Hit (previously visited chunk)

```
ABSENT → REQUESTED → READY → ACTIVE
```

1. Check LRU cache → miss
2. Check disk save → hit
3. Load from disk into typed arrays
4. Mark READY
5. Enter ACTIVE if in range

### New Chunk (never generated)

```
ABSENT → REQUESTED → GENERATING → READY → ACTIVE
```

1. No cache, no save
2. Dispatch to worker pool with (chunkX, chunkY, worldSeed)
3. Worker runs generation pipeline (see [07_world_generation.md])
4. Worker returns typed array payload
5. Mark READY → ACTIVE

---

## Simulation Tick

While ACTIVE:

1. Check if chunk is in simulation range (player + N chunks)
2. If yes → mark SIMULATING, dispatch to sim worker
3. Worker runs crop/building/entity tick
4. Worker returns dirty tile array (only changed indices)
5. Apply patch to CPU chunk data
6. Set `DIRTY_SIMULATION` flag
7. Return to ACTIVE

---

## Dirty Flags

```
DIRTY_SIMULATION  // CPU data changed since last disk write
DIRTY_RENDER      // CPU data changed since last GPU upload
```

- `DIRTY_RENDER` set whenever tile data changes
- Render system rebuilds GPU buffer on next frame if `DIRTY_RENDER` set
- `DIRTY_RENDER` cleared after GPU upload completes

---

## GPU Buffer Lifecycle

| Event              | Action                               |
|--------------------|--------------------------------------|
| Chunk enters render range | Allocate GPU buffer, upload    |
| Tile data changes  | Set `DIRTY_RENDER`                   |
| Next render frame  | Rebuild + re-upload buffer           |
| Chunk leaves render range | Free GPU buffer                |
| Chunk evicted      | Free GPU buffer (if not already freed)|

---

## Eviction Path

```
ACTIVE → EVICTING → ABSENT
```

1. LRU eviction triggered (cache full, chunk far from camera)
2. If `DIRTY_SIMULATION` set → write to disk before eviction
3. Free GPU buffer
4. Remove from LRU cache
5. State → ABSENT

Eviction is async (disk write dispatched to IO worker), chunk stays in EVICTING until write confirmed.

---

## Sync Rules

| Operation          | Thread       | Mechanism          |
|--------------------|--------------|--------------------|
| Generation         | Worker       | Transferable buffer|
| Simulation tick    | Worker       | Transferable buffer|
| Disk IO            | IO Worker    | Async message      |
| GPU upload         | Main thread  | WebGL API call     |
| State transitions  | Main thread  | Synchronous        |

Only the main thread mutates chunk state flags. Workers receive immutable input and return output buffers.

---

## Chunk Activation Range

| Zone                  | Radius (chunks) | Behavior                   |
|-----------------------|-----------------|----------------------------|
| Simulation active     | Player + 3      | Ticked every sim cycle     |
| Render visible        | Camera frustum  | GPU buffer maintained      |
| Cache warm (LRU keep) | Player + 8      | In memory, not ticked      |
| Eviction eligible     | Beyond + 8      | Evicted when cache full    |

---

## Concurrency Invariants

- Only one worker may simulate a given chunk at a time
- Generation and simulation never run concurrently for the same chunk
- Main thread applies all worker results before dispatching next tick for that chunk
- No shared mutable state between workers
