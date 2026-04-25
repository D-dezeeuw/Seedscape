# Playbook — Add a Worker Task Type

A worker task is a unit of work dispatched from the main thread to a worker pool, returning a result via Transferable buffer.

## Steps

### 1. Identify the pool

Which existing pool owns this work?

| Pool        | Owns                                      |
|-------------|-------------------------------------------|
| Generation  | Procedural world creation                 |
| Simulation  | Per-chunk tick (crops, buildings, entities)|
| Mesh        | GPU instance buffer assembly              |
| IO          | IndexedDB / network persistence           |

If none fits → propose a new pool. Justify with throughput numbers; do not add pools speculatively.

### 2. Add a task type enum

In `shared/constants/worker-tasks.ts` (when it exists), add the next integer enum value.

### 3. Define payload schemas

Document input and output payloads in TypeScript types:

```ts
type MyTaskInput = {
  // typed-array fields, total bytes
};

type MyTaskOutput = {
  // typed-array fields, total bytes
};
```

Both must be encodable as a single `ArrayBuffer` for transfer.

### 4. Implement the worker handler

In the worker module:

```ts
function handleMyTask(payload: ArrayBuffer): ArrayBuffer {
  // Decode input
  // Pure logic — no Math.random, no Date.now
  // Allocate output buffer
  // Return output buffer
}
```

Switch on `task.type` in the worker's message handler.

### 5. Add a dispatcher on main thread

Pool dispatch wraps:

```ts
async function dispatchMyTask(input: MyTaskInput): Promise<MyTaskOutput> {
  const buffer = encodeInput(input);
  const result = await pool.dispatch(TASK_TYPE_MY_TASK, buffer);
  return decodeOutput(result.payload);
}
```

### 6. Test determinism

Same input twice → identical output bytes. Add a unit test asserting this.

### 7. Document the message format

Add the input/output schema to [worker architecture doc](../docs/14_worker_architecture.md) under "Message Formats". Future contributors must be able to re-implement the worker from the doc alone.

## Anti-patterns

- Putting business logic in the dispatcher (belongs in the worker)
- Sending plain objects without serialization (slow, uses structured clone)
- Returning errors via thrown exceptions (use `result.success: false, error: string`)
- Coupling task types to chunk coordinates when they're chunk-agnostic
