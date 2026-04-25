// Main-thread wrapper around a pool of simulation workers. Mirrors
// generation_pool: FIFO dispatch, per-task promise. The interaction model is
// different though — sim ticks reuse the chunk's typed-array buffers, which
// means the buffers are unavailable on the main thread while a sim is in
// flight. Callers (ChunkManager) must wait for the result before reading or
// writing the chunk again.

import type { ChunkData } from "../world/chunk";
import type { SimDelta } from "../world/farming/sim_pipeline";
import type { SimRequest, SimResponse } from "./simulation_worker";
import SimulationWorker from "./simulation_worker.ts?worker";

interface PendingTask {
  taskId: number;
  chunkX: number;
  chunkY: number;
  tick: number;
  tileId: ArrayBuffer;
  state: ArrayBuffer;
  metadata: ArrayBuffer;
  resolve: (result: SimTaskResult) => void;
  reject: (error: Error) => void;
}

interface WorkerSlot {
  worker: Worker;
  busy: boolean;
  current: PendingTask | null;
}

export interface SimTaskResult {
  chunkX: number;
  chunkY: number;
  // Caller-owned buffers handed back. Wrap them in a fresh ChunkData if the
  // caller wants to keep using the chunk.
  data: ChunkData;
  delta: SimDelta;
}

function defaultWorkerCount(): number {
  const cores = (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4;
  return Math.max(1, Math.min(4, Math.floor(cores / 2)));
}

export class SimulationPool {
  private readonly slots: WorkerSlot[] = [];
  private readonly queue: PendingTask[] = [];
  private nextTaskId = 1;

  constructor(workerCount: number = defaultWorkerCount()) {
    for (let i = 0; i < workerCount; i++) {
      const worker = new SimulationWorker();
      const slot: WorkerSlot = { worker, busy: false, current: null };
      worker.onmessage = (event: MessageEvent<SimResponse>) => {
        this.handleMessage(slot, event.data);
      };
      worker.onerror = (event: ErrorEvent) => {
        if (slot.current) {
          slot.current.reject(new Error(`simulation worker crashed: ${event.message}`));
          slot.current = null;
        }
      };
      this.slots.push(slot);
    }
  }

  // Dispatch a tick for one chunk. Caller's typed-array buffers are
  // transferred in and back; the returned ChunkData wraps the same buffers.
  tick(chunkX: number, chunkY: number, tick: number, data: ChunkData): Promise<SimTaskResult> {
    return new Promise((resolve, reject) => {
      const task: PendingTask = {
        taskId: this.nextTaskId++,
        chunkX,
        chunkY,
        tick,
        tileId: data.tileId.buffer as ArrayBuffer,
        state: data.state.buffer as ArrayBuffer,
        metadata: data.metadata.buffer as ArrayBuffer,
        resolve,
        reject,
      };
      this.queue.push(task);
      this.tryDispatch();
    });
  }

  get inFlightCount(): number {
    return this.slots.filter((s) => s.busy).length;
  }

  terminate(): void {
    for (const slot of this.slots) slot.worker.terminate();
    this.slots.length = 0;
    for (const task of this.queue) task.reject(new Error("simulation pool terminated"));
    this.queue.length = 0;
  }

  private handleMessage(slot: WorkerSlot, msg: SimResponse): void {
    if (msg.type === "result") {
      const task = slot.current;
      slot.busy = false;
      slot.current = null;
      if (!task || task.taskId !== msg.taskId) {
        this.tryDispatch();
        return;
      }
      task.resolve({
        chunkX: msg.chunkX,
        chunkY: msg.chunkY,
        data: {
          tileId: new Uint16Array(msg.tileIdIn),
          state: new Uint8Array(msg.stateIn),
          metadata: new Uint8Array(msg.metadataIn),
        },
        delta: {
          count: msg.count,
          indices: new Uint16Array(msg.indices),
          tileId: new Uint16Array(msg.deltaTileId),
          state: new Uint8Array(msg.deltaState),
          metadata: new Uint8Array(msg.deltaMetadata),
        },
      });
      this.tryDispatch();
      return;
    }
    if (msg.type === "error") {
      const task = slot.current;
      slot.busy = false;
      slot.current = null;
      if (task && task.taskId === msg.taskId) task.reject(new Error(msg.error));
      this.tryDispatch();
    }
  }

  private tryDispatch(): void {
    while (this.queue.length > 0) {
      const slot = this.slots.find((s) => !s.busy);
      if (!slot) return;
      const task = this.queue.shift() as PendingTask;
      slot.busy = true;
      slot.current = task;
      const req: SimRequest = {
        taskId: task.taskId,
        chunkX: task.chunkX,
        chunkY: task.chunkY,
        tick: task.tick,
        tileId: task.tileId,
        state: task.state,
        metadata: task.metadata,
      };
      slot.worker.postMessage(req, [task.tileId, task.state, task.metadata]);
    }
  }
}
