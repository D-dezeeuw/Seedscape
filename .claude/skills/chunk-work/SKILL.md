---
name: chunk-work
description: Use when implementing or modifying chunk system code — chunk data layout, LRU cache, chunk lifecycle states, dirty flags, generation/simulation/render boundaries, or anything touching the 32×32 tile chunk unit.
---

# Chunk Work

The chunk is Seedscape's atomic unit. All systems operate at chunk granularity: generation, simulation, rendering, persistence.

## Mandatory Reading (in order)

1. [data model](../../context/docs/05_data_model.md) — typed array layout for tileId/state/metadata
2. [chunk lifecycle](../../context/docs/13_chunk_lifecycle.md) — state machine, dirty flags, sync rules
3. [memory & performance](../../context/docs/06_memory_performance.md) — budgets, LRU rules, GC avoidance

## Hard Rules

- **Typed arrays only.** `Uint16Array` for tileId, `Uint8Array` for state and metadata. Never `Array<TileObject>`.
- **Chunk size is 32×32 = 1024 tiles.** Hardcode `CHUNK_SIZE = 32` as a single constant; never inline.
- **Tile index = `y * 32 + x`.** Always.
- **Only main thread mutates chunk state flags.** Workers are pure I/O.
- **One worker per chunk at a time.** Generation and simulation never run concurrently for the same chunk.
- **Delta-only sim output.** Workers return `{indices, state, metadata}` of changed tiles, not full arrays.

## State Machine Reminder

```
ABSENT → REQUESTED → GENERATING → READY → ACTIVE → EVICTING → ABSENT
                                              ↕
                                        SIMULATING / RENDERING
```

Dirty flags: `DIRTY_SIMULATION` (CPU diverged from disk), `DIRTY_RENDER` (CPU diverged from GPU).

## Constants from `data/tiles.json`

`stateFlags` and `chunkFlags` are defined in [data/tiles.json](../../../data/tiles.json). Import from there, do not redefine.

## Common Pitfalls

- Don't allocate per-tile in tick loops. Pre-allocate output buffers.
- Don't forget to `Transferable` the buffer back from workers.
- Don't evict a chunk without writing dirty data to disk first.
- Don't render a chunk while it's `GENERATING`.

## Before You Code

State your plan briefly: which state transitions you're touching, which dirty flags get set, and where the typed array allocations happen.
