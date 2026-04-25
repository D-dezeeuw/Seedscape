// Main-thread wrapper around a pool of simulation workers. FIFO dispatch.
//
// The pool COPIES chunk data into fresh buffers before transferring them to
// the worker. The original chunk arrays stay live on the main thread, so
// concurrent reads (autosave, hover/picker, render uploads) keep working
// while a sim is in flight. The 4 KB/chunk/tick copy is well below the
// throughput target in docs/06_memory_performance.md.

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

  // Dispatch a tick for one chunk. Caller's chunk data is copied into fresh
  // buffers; those copies are what gets transferred to the worker. The
  // caller's original buffers are never detached.
  tick(chunkX: number, chunkY: number, tick: number, data: ChunkData): Promise<SimTaskResult> {
    return new Promise((resolve, reject) => {
      const tileIdCopy = new Uint16Array(data.tileId);
      const stateCopy = new Uint8Array(data.state);
      const metadataCopy = new Uint8Array(data.metadata);
      const task: PendingTask = {
        taskId: this.nextTaskId++,
        chunkX,
        chunkY,
        tick,
        tileId: tileIdCopy.buffer as ArrayBuffer,
        state: stateCopy.buffer as ArrayBuffer,
        metadata: metadataCopy.buffer as ArrayBuffer,
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
