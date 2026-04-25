---
name: worker-work
description: Use when adding or modifying Web Workers, worker pool dispatch, message protocols, transferable buffers, or worker task definitions for generation/simulation/mesh/IO.
---

# Worker Work

Workers are pure input/output systems. No shared mutable state. Communication via Transferable buffers.

## Mandatory Reading

1. [worker architecture](../../context/docs/14_worker_architecture.md) — pool design, message formats
2. [memory & performance](../../context/docs/06_memory_performance.md) — throughput targets
3. [chunk lifecycle](../../context/docs/13_chunk_lifecycle.md) — sync rules

## Hard Rules

- **Workers are pure.** Same input → same output. No global state.
- **No `Math.random()`.** Use seeded RNG only — workers must be deterministic.
- **No `Date.now()` / `performance.now()`** in simulation logic. Use the tick counter passed as input.
- **Transferable, not clone.** Pass `ArrayBuffer` via `postMessage(msg, [buffer])`. Buffer ownership transfers.
- **One pool per task type.** Generation, simulation, mesh, IO have separate pools. No task stealing across pools.
- **FIFO within pool.** No reordering, no priority queues (until proven necessary).
- **Delta-only output for sim tasks.** Return `{count, indices, state, metadata}` — not the whole 1024-tile array.

## Worker Types

| Pool        | Count    | Purpose                              |
|-------------|----------|--------------------------------------|
| Generation  | 2–4      | Noise → tileId/state/metadata        |
| Simulation  | 2–4      | Crop tick, building tick, entity tick|
| Mesh        | 1–2      | Build instance buffers               |
| IO          | 1        | IndexedDB read/write                 |

Worker count scales to `navigator.hardwareConcurrency`. Minimum: 1 generation + 1 sim + 1 IO.

## Message Envelope

```ts
type WorkerTask = {
  taskId: number;     // Uint32, unique
  type: number;       // task type enum
  chunkX: number;
  chunkY: number;
  payload: ArrayBuffer;
};

type WorkerResult = {
  taskId: number;
  success: boolean;
  payload: ArrayBuffer;
  error?: string;
};
```

## Determinism Checklist

Before merging a worker change, verify:

- [ ] No `Math.random()` calls
- [ ] No `Date.now()` / `performance.now()`
- [ ] No DOM, no `window`, no `globalThis` mutation
- [ ] Same input payload → same output payload (write a test)
- [ ] Output buffer is freshly allocated (no shared state)

## Common Pitfalls

- **Forgot to transfer the buffer** → silent copy, slow, double memory.
- **Worker mutates input** → undefined behavior after transfer back.
- **Used a non-pure dependency** (e.g. UUID generator using `crypto.randomUUID`).
- **Returned full chunk array** instead of delta — wastes bandwidth.

## Adding a New Task Type

Follow [add-worker-task playbook](../../context/playbooks/add-worker-task.md).
