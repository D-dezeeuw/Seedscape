# Playbook — Wire a New Simulation System

A "system" is a tick-driven module that operates on chunk data (e.g. crop growth, building production, animal feeding, weather).

## Decision: Tick or Event?

| Trigger                       | Use         |
|-------------------------------|-------------|
| Continuous state change       | Tick system |
| Player action                 | Event       |
| External signal (NPC, market) | Event       |

Tick systems run inside the simulation worker. Events are dispatched from the main thread.

## Steps for a Tick System

### 1. Define what tile state it reads/writes

Be specific:
- Which tileId range does it operate on?
- Which `state` bits or `metadata` bits does it modify?
- Does it produce side effects (inventory, coin, XP)?

### 2. Update [05_data_model.md](../docs/05_data_model.md)

If you're using new metadata bits, document the bit layout. Bits must not collide with existing systems.

### 3. Add the tick handler in the simulation worker

Each sim tick iterates active chunks:

```ts
function tickChunk(chunk: ChunkPayload, tick: number): ChunkDelta {
  for (let i = 0; i < 1024; i++) {
    if (myTileMatches(chunk.tileId[i])) {
      mySystem.tick(chunk, i, tick);
    }
  }
  return collectDelta();
}
```

Tick handlers must be pure: same input → same delta. Use seeded RNG (chunk seed + tile index).

### 4. Side effects via events

If the system needs to modify player inventory, coin balance, or XP — emit an event in the delta payload:

```ts
type ChunkDeltaEvent = {
  type: number;
  payload: ArrayBuffer;
};
```

Main thread applies events after applying tile deltas.

### 5. Hook into the tick scheduler

Tick scheduler iterates all systems in registration order. Order matters:

1. Crop growth (consumes water)
2. Animal feeding (produces fertilizer)
3. Building production (consumes inputs)
4. Irrigation (refills water)

Add your system at the appropriate position. Document why if non-obvious.

### 6. Performance budget

Per-chunk tick must stay under 5ms (see [06_memory_performance.md](../docs/06_memory_performance.md)). If your system iterates all 1024 tiles per tick, profile early.

Optimization escape hatches:
- Maintain a chunk-level "active tiles" index (only iterate tiles of relevant type)
- Tick at lower frequency (every Nth sim tick)
- Defer heavy work to mesh-build phase

### 7. Add a determinism test

```ts
test("system X produces same delta for same input", () => {
  const delta1 = tickChunk(input, 0);
  const delta2 = tickChunk(input, 0);
  expect(delta1).toEqual(delta2);
});
```

## Common Pitfalls

- Reading from `Date.now()` or `performance.now()` (breaks determinism)
- Mutating chunk arrays during iteration (corrupts later iterations)
- Forgetting to set `DIRTY_RENDER` when state changes
- Cross-chunk state dependencies (chunks must tick independently)
