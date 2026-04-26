// Main-thread client for the pathfinding worker. Hides the message protocol
// behind a promise API and a small cache.
//
// Single-worker by design (per docs/22). Promote to a pool only if profile
// data shows the queue starving. The client itself is pool-agnostic — callers
// just see `requestPath`.
//
// Caching: results are keyed by (start, goal). On gridVersion change the
// cache is cleared wholesale rather than walked — the bump only happens on
// real grid mutations, and 99% of cached entries become stale anyway when
// the world's walkability shifts (a building going down invalidates many
// reachability assumptions, not just paths through that exact tile).

import type {
  GridAckMessage,
  InitGridRequest,
  InvalidateChunkRequest,
  PathfindingResponse,
  PathRequestMessage,
  PathResultMessage,
  UpdateChunkRequest,
} from "./pathfinding_worker";
import PathfindingWorker from "./pathfinding_worker.ts?worker";

export interface PathfindingClientOptions {
  // Override worker construction for tests. Production code uses the default
  // which spins up the Vite-bundled worker.
  worker?: Worker;
}

export interface PathReply {
  found: boolean;
  // Flat (x,y) world tile coords. Empty if !found.
  waypoints: Int16Array;
  // gridVersion the result was computed against. Caller can compare against
  // a later snapshot to know if the path is stale.
  gridVersion: number;
}

interface PendingPath {
  resolve: (reply: PathReply) => void;
  reject: (err: Error) => void;
  cacheKey: string;
}

const cacheKeyOf = (sx: number, sy: number, gx: number, gy: number): string =>
  `${sx},${sy}|${gx},${gy}`;

export class PathfindingClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, PendingPath>();
  // Pending grid mutations, deduped by chunk key. A subsequent UPDATE for the
  // same chunk replaces the prior one — the latest mask is the only one that
  // matters for any path planned after the flush.
  private readonly pendingUpdates = new Map<string, Uint8Array>();
  private readonly pendingInvalidations = new Set<string>();
  private flushScheduled = false;
  private nextRequestId = 1;
  private cache = new Map<string, PathReply>();
  private localGridVersion = 0;
  private terminated = false;

  constructor(opts: PathfindingClientOptions = {}) {
    this.worker = opts.worker ?? this.createDefaultWorker();
    this.worker.onmessage = (event: MessageEvent<PathfindingResponse>) => {
      this.handleMessage(event.data);
    };
    this.worker.onerror = (event: ErrorEvent) => {
      // Worker died. Reject everything in flight; subsequent requestPath
      // calls reject immediately. Recovery would need respawning + grid
      // re-init; out of scope for Phase 7.
      const err = new Error(`pathfinding worker crashed: ${event.message}`);
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
      this.terminated = true;
    };
  }

  private createDefaultWorker(): Worker {
    return new PathfindingWorker();
  }

  get gridVersion(): number {
    return this.localGridVersion;
  }

  // Bulk-install at boot. Replaces any prior grid in the worker.
  initGrid(chunks: Array<{ key: string; mask: Uint8Array }>): void {
    if (this.terminated) return;
    // Copy each mask into its own buffer; we transfer those copies so the
    // caller's masks stay live (chunk_manager keeps the canonical mask alive).
    const payload = chunks.map((c) => ({ key: c.key, mask: c.mask.slice().buffer as ArrayBuffer }));
    const msg: InitGridRequest = { type: "INIT_GRID", chunks: payload };
    this.worker.postMessage(
      msg,
      payload.map((p) => p.mask),
    );
    // Pre-clear local cache; any cached path is from before this grid.
    this.cache.clear();
  }

  // Mark a chunk's walkability as changed. Coalesced per microtask — multiple
  // calls within the same synchronous task post once. The mask is copied
  // immediately so callers can reuse a scratch buffer across many chunks
  // without later mutations leaking into already-queued entries.
  updateChunk(key: string, mask: Uint8Array): void {
    if (this.terminated) return;
    this.pendingInvalidations.delete(key);
    this.pendingUpdates.set(key, new Uint8Array(mask));
    this.scheduleFlush();
  }

  invalidateChunk(key: string): void {
    if (this.terminated) return;
    this.pendingUpdates.delete(key);
    this.pendingInvalidations.add(key);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    queueMicrotask(() => this.flush());
  }

  private flush(): void {
    this.flushScheduled = false;
    if (this.terminated) return;
    for (const [key, mask] of this.pendingUpdates) {
      // mask is already a private copy (made on enqueue) — transfer its
      // buffer directly to the worker without another slice.
      const buf = mask.buffer as ArrayBuffer;
      const msg: UpdateChunkRequest = { type: "UPDATE_CHUNK", key, mask: buf };
      this.worker.postMessage(msg, [buf]);
    }
    this.pendingUpdates.clear();
    for (const key of this.pendingInvalidations) {
      const msg: InvalidateChunkRequest = { type: "INVALIDATE", key };
      this.worker.postMessage(msg);
    }
    this.pendingInvalidations.clear();
  }

  // Request a path. Resolves with waypoints (Int16Array) or a not-found reply.
  // Cached by (start, goal) for the current gridVersion; on version bump the
  // cache is cleared so callers can request fresh planning after world edits.
  requestPath(
    start: { x: number; y: number },
    goal: { x: number; y: number },
    options: { maxNodes?: number } = {},
  ): Promise<PathReply> {
    if (this.terminated) {
      return Promise.reject(new Error("pathfinding client terminated"));
    }
    const key = cacheKeyOf(start.x, start.y, goal.x, goal.y);
    const cached = this.cache.get(key);
    if (cached) return Promise.resolve(cached);

    return new Promise<PathReply>((resolve, reject) => {
      const requestId = this.nextRequestId++;
      this.pending.set(requestId, { resolve, reject, cacheKey: key });
      const msg: PathRequestMessage = {
        type: "PATH_REQUEST",
        requestId,
        start,
        goal,
        ...(options.maxNodes !== undefined ? { maxNodes: options.maxNodes } : {}),
      };
      this.worker.postMessage(msg);
    });
  }

  terminate(): void {
    if (this.terminated) return;
    this.terminated = true;
    const reason = new Error("pathfinding client terminated");
    for (const p of this.pending.values()) p.reject(reason);
    this.pending.clear();
    this.pendingUpdates.clear();
    this.pendingInvalidations.clear();
    this.worker.terminate();
  }

  private handleMessage(msg: PathfindingResponse): void {
    if (msg.type === "GRID_ACK") {
      this.handleAck(msg);
      return;
    }
    if (msg.type === "PATH_RESULT") {
      this.handleResult(msg);
    }
  }

  private handleAck(msg: GridAckMessage): void {
    if (msg.gridVersion !== this.localGridVersion) {
      this.localGridVersion = msg.gridVersion;
      this.cache.clear();
    }
  }

  private handleResult(msg: PathResultMessage): void {
    const pending = this.pending.get(msg.requestId);
    if (!pending) return; // already terminated or rejected
    this.pending.delete(msg.requestId);
    const reply: PathReply = {
      found: msg.found,
      waypoints: new Int16Array(msg.waypoints),
      gridVersion: msg.gridVersion,
    };
    // Sync gridVersion if the worker has moved past us (it bumps on every
    // mutation; ACKs and results both carry it).
    if (msg.gridVersion > this.localGridVersion) {
      this.localGridVersion = msg.gridVersion;
      // Don't clear cache here; results from older versions won't get cached
      // because the cache check below is keyed off gridVersion.
    }
    if (msg.gridVersion === this.localGridVersion) {
      this.cache.set(pending.cacheKey, reply);
    }
    pending.resolve(reply);
  }
}
