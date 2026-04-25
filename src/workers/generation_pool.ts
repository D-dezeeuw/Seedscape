// Main-thread wrapper around a pool of generation workers. FIFO dispatch,
// no priority. Per docs/14_worker_architecture.md.

import type { ChunkData } from "../world/chunk";
import type { GenerationRequest, GenerationResponse } from "./generation_worker";
import GenerationWorker from "./generation_worker.ts?worker";

interface PendingTask {
  taskId: number;
  chunkX: number;
  chunkY: number;
  resolve: (data: ChunkData) => void;
  reject: (error: Error) => void;
}

interface WorkerSlot {
  worker: Worker;
  busy: boolean;
  ready: boolean;
  current: PendingTask | null;
}

function defaultWorkerCount(): number {
  // Half of hardwareConcurrency, clamped 1..4. Per worker-architecture doc.
  const cores = (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4;
  return Math.max(1, Math.min(4, Math.floor(cores / 2)));
}

export class GenerationPool {
  private readonly slots: WorkerSlot[] = [];
  private readonly queue: PendingTask[] = [];
  private nextTaskId = 1;
  private readyResolve: (() => void) | null = null;
  private readyPromise: Promise<void>;
  private readyCount = 0;

  constructor(worldSeed: number, workerCount: number = defaultWorkerCount()) {
    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve;
    });

    for (let i = 0; i < workerCount; i++) {
      const worker = new GenerationWorker();
      const slot: WorkerSlot = { worker, busy: false, ready: false, current: null };
      worker.onmessage = (event: MessageEvent<GenerationResponse>) => {
        this.handleMessage(slot, event.data);
      };
      worker.onerror = (event: ErrorEvent) => {
        // Surface worker crashes to any in-flight task; further work won't
        // dispatch to a dead worker because busy stays true.
        if (slot.current) {
          slot.current.reject(new Error(`generation worker crashed: ${event.message}`));
          slot.current = null;
        }
      };
      const initMsg: GenerationRequest = { type: "init", worldSeed };
      worker.postMessage(initMsg);
      this.slots.push(slot);
    }
  }

  async ready(): Promise<void> {
    return this.readyPromise;
  }

  generate(chunkX: number, chunkY: number): Promise<ChunkData> {
    return new Promise((resolve, reject) => {
      const task: PendingTask = {
        taskId: this.nextTaskId++,
        chunkX,
        chunkY,
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

  get queueLength(): number {
    return this.queue.length;
  }

  terminate(): void {
    for (const slot of this.slots) slot.worker.terminate();
    this.slots.length = 0;
    for (const task of this.queue) task.reject(new Error("generation pool terminated"));
    this.queue.length = 0;
  }

  private handleMessage(slot: WorkerSlot, msg: GenerationResponse): void {
    if (msg.type === "ready") {
      slot.ready = true;
      this.readyCount++;
      if (this.readyCount === this.slots.length && this.readyResolve) {
        this.readyResolve();
        this.readyResolve = null;
      }
      this.tryDispatch();
      return;
    }
    if (msg.type === "result") {
      const task = slot.current;
      if (!task || task.taskId !== msg.taskId) {
        // Stale result (worker crash + reuse). Ignore; the original task was
        // already rejected by onerror.
        slot.busy = false;
        slot.current = null;
        this.tryDispatch();
        return;
      }
      const chunkData: ChunkData = {
        tileId: new Uint16Array(msg.tileId),
        state: new Uint8Array(msg.state),
        metadata: new Uint8Array(msg.metadata),
      };
      task.resolve(chunkData);
      slot.busy = false;
      slot.current = null;
      this.tryDispatch();
      return;
    }
    if (msg.type === "error") {
      const task = slot.current;
      slot.busy = false;
      slot.current = null;
      if (task && task.taskId === msg.taskId) {
        task.reject(new Error(msg.error));
      }
      this.tryDispatch();
    }
  }

  private tryDispatch(): void {
    while (this.queue.length > 0) {
      const slot = this.slots.find((s) => s.ready && !s.busy);
      if (!slot) return;
      const task = this.queue.shift() as PendingTask;
      slot.busy = true;
      slot.current = task;
      const req: GenerationRequest = {
        type: "generate",
        taskId: task.taskId,
        chunkX: task.chunkX,
        chunkY: task.chunkY,
      };
      slot.worker.postMessage(req);
    }
  }
}
