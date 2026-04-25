# Seedscape — Worker Architecture

## Principle

Workers are pure input/output systems. No shared mutable state. All communication via message passing with Transferable buffers.

---

## Worker Types

| Worker type     | Count     | Responsibilities                       |
|-----------------|-----------|----------------------------------------|
| Generation      | 2–4       | World gen, noise, tile assignment      |
| Simulation      | 2–4       | Crop tick, building tick, entity tick  |
| Mesh builder    | 1–2       | Instance buffer preparation            |
| IO              | 1         | Disk read/write (IndexedDB / server)   |

Total workers: 6–11 (tuned to device core count).

---

## Worker Pool Design

Each worker type has a dedicated pool.

```
WorkerPool {
  workers:   Worker[]       // fixed-size pool
  queue:     Task[]         // pending tasks
  inFlight:  Map<id, Task>  // dispatched, awaiting result
}
```

### Dispatch Rule

- If pool has idle worker → dispatch immediately
- Else → enqueue task
- Tasks are FIFO within pool
- No task stealing across pool types

---

## Task Format

All tasks follow the same envelope:

```
WorkerTask {
  taskId:   Uint32       // unique task id
  type:     Uint8        // task type enum
  chunkX:   Int32
  chunkY:   Int32
  payload:  ArrayBuffer  // input data (Transferable)
}
```

Worker response:

```
WorkerResult {
  taskId:   Uint32
  success:  boolean
  payload:  ArrayBuffer  // output data (Transferable)
  error?:   string
}
```

---

## Message Formats

### Generation Task

Input payload:
```
{ worldSeed: Uint32, chunkX: Int32, chunkY: Int32 }
```

Output payload:
```
{
  tileId:   Uint16[1024]
  state:    Uint8[1024]
  metadata: Uint8[1024]
}
```

### Simulation Task

Input payload:
```
{
  tileId:   Uint16[1024]
  state:    Uint8[1024]
  metadata: Uint8[1024]
  chunkSeed: Uint32
  tick:     Uint32
}
```

Output payload:
```
{
  count:   Uint16         // number of changed tiles
  indices: Uint16[count]  // tile indices that changed
  state:   Uint8[count]   // new state values
  metadata:Uint8[count]   // new metadata values
}
```

Delta output only — unchanged tiles omitted.

### Mesh Task

Input payload:
```
{
  tileId:    Uint16[1024]
  state:     Uint8[1024]
  chunkX:    Int32
  chunkY:    Int32
}
```

Output payload:
```
{
  positions:   Float32[1024 * 2]
  tileIndices: Float32[1024]
  stateFlags:  Float32[1024]
}
```

---

## Transferable Buffer Strategy

All `ArrayBuffer` payloads transferred (not copied) using `postMessage(msg, [buffer])`.

- Zero-copy across thread boundary
- Buffer ownership transfers to worker; main thread cannot access until result returned
- Workers allocate fresh output buffers per task (pre-allocated pool optional)

---

## Task Scheduling

Main thread tick loop:

```
each sim tick:
  for each ACTIVE chunk:
    if not in-flight:
      build SimulationTask from chunk data
      transfer buffer to sim worker pool
      mark chunk in-flight

  for each returned result:
    apply delta to chunk CPU data
    set DIRTY flags
    mark chunk idle
```

Generation tasks dispatched on demand (camera movement / new area).

---

## Determinism Constraints

- Workers must not use `Math.random()` — use seeded RNG only
- Workers must not use `Date.now()` or `performance.now()` for simulation logic
- Given same input payload → always same output payload
- Worker code is pure: no side effects, no external state

---

## Error Handling

- Worker crash → pool detects via `onerror`
- Task re-queued up to 3 times
- Chunk marked ERRORED after repeated failure
- ERRORED chunks rendered with placeholder tile, not simulated

---

## Device Scaling

Worker count scales to available hardware:

```
generationWorkers = clamp(navigator.hardwareConcurrency / 2, 1, 4)
simWorkers        = clamp(navigator.hardwareConcurrency / 2, 2, 4)
meshWorkers       = 1
ioWorker          = 1
```

Minimum viable: 1 generation + 1 simulation + 1 IO = 3 workers.
