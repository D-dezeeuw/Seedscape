import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { TILES_PER_CHUNK } from "../world/chunk";
import { chunkKey } from "../world/coords";
import { PathfindingClient } from "./pathfinding_client";
import { findPath, PathfinderWorkspace, type PathGrid } from "./pathfinding_core";
import type { PathfindingRequest, PathfindingResponse } from "./pathfinding_worker";

// In-process fake worker that mirrors the real pathfinding_worker.ts protocol.
// Lets us exercise the client's request/response wiring without Vite/DOM.
class FakeWorker {
  // Worker-side handler the client installs.
  onmessage: ((ev: MessageEvent<PathfindingResponse>) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  terminated = false;

  private readonly grid: PathGrid = { masks: new Map() };
  private gridVersion = 0;
  private readonly ws = new PathfinderWorkspace();
  // Simulate worker async dispatch — the real worker runs onmessage in its
  // own task, so we ape that with queueMicrotask to keep ordering realistic.
  private deliver(msg: PathfindingResponse): void {
    queueMicrotask(() => {
      if (this.terminated || !this.onmessage) return;
      this.onmessage(new MessageEvent("message", { data: msg }));
    });
  }

  postMessage(msg: PathfindingRequest, _transfer?: Transferable[]): void {
    if (this.terminated) return;
    switch (msg.type) {
      case "INIT_GRID":
        this.grid.masks.clear();
        for (const c of msg.chunks) {
          this.grid.masks.set(c.key, new Uint8Array(c.mask));
        }
        this.gridVersion++;
        this.deliver({ type: "GRID_ACK", gridVersion: this.gridVersion });
        return;
      case "UPDATE_CHUNK":
        this.grid.masks.set(msg.key, new Uint8Array(msg.mask));
        this.gridVersion++;
        this.deliver({ type: "GRID_ACK", gridVersion: this.gridVersion });
        return;
      case "INVALIDATE":
        if (this.grid.masks.delete(msg.key)) this.gridVersion++;
        this.deliver({ type: "GRID_ACK", gridVersion: this.gridVersion });
        return;
      case "PATH_REQUEST": {
        const result = findPath(
          this.grid,
          {
            start: msg.start,
            goal: msg.goal,
            ...(msg.maxNodes !== undefined ? { maxNodes: msg.maxNodes } : {}),
          },
          this.ws,
        );
        this.deliver({
          type: "PATH_RESULT",
          requestId: msg.requestId,
          found: result.found,
          waypoints: result.waypoints.buffer as ArrayBuffer,
          gridVersion: this.gridVersion,
          expanded: result.expanded,
        });
        return;
      }
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  // EventTarget-shaped no-ops; client only assigns onmessage/onerror.
  addEventListener(): void {}
  removeEventListener(): void {}
  dispatchEvent(): boolean {
    return false;
  }
}

function emptyMask(): Uint8Array {
  return new Uint8Array(TILES_PER_CHUNK).fill(1);
}

function makeClient(): { client: PathfindingClient; worker: FakeWorker } {
  const worker = new FakeWorker();
  const client = new PathfindingClient({ worker: worker as unknown as Worker });
  return { client, worker };
}

describe("PathfindingClient", () => {
  let client: PathfindingClient;
  let worker: FakeWorker;

  beforeEach(() => {
    const m = makeClient();
    client = m.client;
    worker = m.worker;
    void worker; // referenced via client; keep handle for tests that need it
  });

  afterEach(() => {
    client.terminate();
  });

  test("requestPath returns waypoints across init grid + simple path", async () => {
    client.initGrid([{ key: chunkKey(0, 0), mask: emptyMask() }]);
    const reply = await client.requestPath({ x: 0, y: 0 }, { x: 5, y: 0 });
    expect(reply.found).toBe(true);
    expect(reply.waypoints.length).toBeGreaterThan(0);
    expect(reply.waypoints[reply.waypoints.length - 2]).toBe(5);
  });

  test("caches duplicate requests for the same gridVersion", async () => {
    client.initGrid([{ key: chunkKey(0, 0), mask: emptyMask() }]);
    const a = await client.requestPath({ x: 0, y: 0 }, { x: 3, y: 0 });
    const b = await client.requestPath({ x: 0, y: 0 }, { x: 3, y: 0 });
    // Same Int16Array reference proves we hit the cache.
    expect(b).toBe(a);
  });

  test("cache invalidates when grid version changes", async () => {
    client.initGrid([{ key: chunkKey(0, 0), mask: emptyMask() }]);
    const a = await client.requestPath({ x: 0, y: 0 }, { x: 3, y: 0 });
    // Update a chunk → bumps gridVersion → cache should clear.
    client.updateChunk(chunkKey(0, 0), emptyMask());
    // Wait a microtask so the flush + ACK round-trip lands.
    await Promise.resolve();
    await Promise.resolve();
    const b = await client.requestPath({ x: 0, y: 0 }, { x: 3, y: 0 });
    expect(b).not.toBe(a);
    expect(b.found).toBe(true);
  });

  test("coalesces multiple updateChunk calls in one flush", async () => {
    client.initGrid([{ key: chunkKey(0, 0), mask: emptyMask() }]);
    // First: drain init's ACK.
    await client.requestPath({ x: 0, y: 0 }, { x: 1, y: 0 });
    const versionBefore = client.gridVersion;
    // 5 calls for the same chunk in one task → one UPDATE_CHUNK on flush.
    for (let i = 0; i < 5; i++) {
      client.updateChunk(chunkKey(0, 0), emptyMask());
    }
    await Promise.resolve();
    await Promise.resolve();
    expect(client.gridVersion).toBe(versionBefore + 1);
  });

  test("returns not-found when goal is unreachable / unloaded", async () => {
    client.initGrid([{ key: chunkKey(0, 0), mask: emptyMask() }]);
    // Goal is in chunk (1, 0) which we never loaded.
    const reply = await client.requestPath({ x: 0, y: 0 }, { x: 35, y: 0 });
    expect(reply.found).toBe(false);
    expect(reply.waypoints.length).toBe(0);
  });

  test("updateChunk copies the mask so callers can reuse a scratch buffer", async () => {
    client.initGrid([{ key: chunkKey(0, 0), mask: emptyMask() }]);
    await Promise.resolve();
    // One scratch reused for two chunks in the same task.
    const scratch = new Uint8Array(TILES_PER_CHUNK);
    scratch.fill(1); // chunk A: all walkable
    client.updateChunk(chunkKey(1, 0), scratch);
    scratch.fill(0); // chunk B: all blocked — mutates the same buffer
    client.updateChunk(chunkKey(2, 0), scratch);
    await Promise.resolve();
    await Promise.resolve();
    // Chunk (1,0) at world tile (32, 0) should still be walkable from origin.
    const reachA = await client.requestPath({ x: 0, y: 0 }, { x: 33, y: 0 });
    expect(reachA.found).toBe(true);
    // Chunk (2,0) at world tile (64, 0) should be blocked end-to-end.
    const reachB = await client.requestPath({ x: 0, y: 0 }, { x: 65, y: 0 });
    expect(reachB.found).toBe(false);
  });

  test("terminate rejects in-flight requests", async () => {
    client.initGrid([{ key: chunkKey(0, 0), mask: emptyMask() }]);
    // Start a request but don't await first.
    const promise = client.requestPath({ x: 0, y: 0 }, { x: 10, y: 0 });
    client.terminate();
    await expect(promise).rejects.toThrow(/terminated/);
  });
});
