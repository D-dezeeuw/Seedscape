// Main-thread wrapper around the single IO worker. Per worker-architecture
// doc this pool is fixed at one worker (IndexedDB transactions serialize
// anyway, so more workers wouldn't help).

import type { IoRequest, IoResponse } from "./io_worker";
import IoWorker from "./io_worker.ts?worker";

interface PendingTask {
  taskId: number;
  resolve: (response: IoResponse) => void;
  reject: (error: Error) => void;
}

export class IoClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, PendingTask>();
  private nextTaskId = 1;

  constructor() {
    this.worker = new IoWorker();
    this.worker.onmessage = (event: MessageEvent<IoResponse>) => {
      const msg = event.data;
      const task = this.pending.get(msg.taskId);
      if (!task) return;
      this.pending.delete(msg.taskId);
      if (msg.type === "error") task.reject(new Error(msg.error));
      else task.resolve(msg);
    };
    this.worker.onerror = (event: ErrorEvent) => {
      // IO worker death is rare; reject everything in flight.
      for (const task of this.pending.values()) {
        task.reject(new Error(`io worker crashed: ${event.message}`));
      }
      this.pending.clear();
    };
  }

  save(payload: unknown): Promise<void> {
    return this.dispatch({ type: "save", taskId: this.nextTaskId++, payload }).then(
      () => undefined,
    );
  }

  async load<T = unknown>(): Promise<T | null> {
    const response = await this.dispatch({ type: "load", taskId: this.nextTaskId++ });
    if (response.type !== "loaded") throw new Error("unexpected io response");
    return (response.payload as T | null) ?? null;
  }

  delete(): Promise<void> {
    return this.dispatch({ type: "delete", taskId: this.nextTaskId++ }).then(() => undefined);
  }

  terminate(): void {
    this.worker.terminate();
    for (const task of this.pending.values()) task.reject(new Error("io client terminated"));
    this.pending.clear();
  }

  private dispatch(req: IoRequest): Promise<IoResponse> {
    return new Promise((resolve, reject) => {
      this.pending.set(req.taskId, { taskId: req.taskId, resolve, reject });
      this.worker.postMessage(req);
    });
  }
}
