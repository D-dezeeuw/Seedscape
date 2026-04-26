// Regression: 150 settlers spawned simultaneously must not all hit the
// pathfinding worker on the same tick. The stagger spreads first-claim
// attempts over FIRST_CLAIM_STAGGER_SEC; failed re-claims get a jittered
// backoff so 150 idle settlers don't rescan the board every entity tick.
//
// We wire a fake worker that counts PATH_REQUEST messages and assert the
// per-tick maximum stays below a tight cap.

import { describe, expect, test } from "vitest";
import { PathfindingClient } from "../../workers/pathfinding_client";
import { findPath, PathfinderWorkspace, type PathGrid } from "../../workers/pathfinding_core";
import type { PathfindingRequest, PathfindingResponse } from "../../workers/pathfinding_worker";
import {
  allocChunkData,
  CHUNK_FLAG_DIRTY_RENDER,
  CHUNK_SIZE,
  type ChunkRecord,
  tileIndex,
} from "../../world/chunk";
import { chunkKey } from "../../world/coords";
import { CRATE_TILE_ID, CrateStore } from "../../world/farming/crate";
import { CROP_STAGE_HARVESTABLE } from "../../world/farming/crop_registry";
import { harvestTile, waterTile } from "../../world/farming/tile_actions";
import { buildChunkMask } from "../../world/walkability";
import { JOB_KIND_HARVEST_CROP, JobBoard } from "../jobs";
import type { EntityServices, EntityTickContext, TileWorldAccess } from "./entity";
import { EntityManager } from "./entity_manager";
import { Villager } from "./villager";

const WHEAT_BASE = 100;
const TILE_DRY_GRASS = 10;

// Counting fake worker — same protocol as the real pathfinding_worker.ts
// but instrumented so the test can ask "how many path requests landed in
// the last tick?".
class CountingFakeWorker {
  onmessage: ((ev: MessageEvent<PathfindingResponse>) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  private grid: PathGrid = { masks: new Map() };
  private gridVersion = 0;
  private ws = new PathfinderWorkspace();
  // Number of PATH_REQUEST messages received since the last reset().
  pathRequestsThisTick = 0;
  // History of per-tick counts; pushed by callers between ticks.
  history: number[] = [];

  resetTickCounter(): void {
    this.history.push(this.pathRequestsThisTick);
    this.pathRequestsThisTick = 0;
  }

  private deliver(msg: PathfindingResponse): void {
    queueMicrotask(() => this.onmessage?.(new MessageEvent("message", { data: msg })));
  }

  postMessage(msg: PathfindingRequest): void {
    if (msg.type === "INIT_GRID") {
      this.grid.masks.clear();
      for (const c of msg.chunks) this.grid.masks.set(c.key, new Uint8Array(c.mask));
      this.gridVersion++;
      this.deliver({ type: "GRID_ACK", gridVersion: this.gridVersion });
    } else if (msg.type === "UPDATE_CHUNK") {
      this.grid.masks.set(msg.key, new Uint8Array(msg.mask));
      this.gridVersion++;
      this.deliver({ type: "GRID_ACK", gridVersion: this.gridVersion });
    } else if (msg.type === "INVALIDATE") {
      this.grid.masks.delete(msg.key);
      this.gridVersion++;
      this.deliver({ type: "GRID_ACK", gridVersion: this.gridVersion });
    } else if (msg.type === "PATH_REQUEST") {
      this.pathRequestsThisTick++;
      const r = findPath(
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
        found: r.found,
        waypoints: r.waypoints.buffer as ArrayBuffer,
        gridVersion: this.gridVersion,
        expanded: r.expanded,
      });
    }
  }
  terminate(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
  dispatchEvent(): boolean {
    return false;
  }
}

function buildWorld(): { chunks: Map<string, ChunkRecord>; crates: CrateStore } {
  const chunks = new Map<string, ChunkRecord>();
  for (let cy = 0; cy < 4; cy++) {
    for (let cx = 0; cx < 4; cx++) {
      const data = allocChunkData();
      for (let i = 0; i < data.tileId.length; i++) data.tileId[i] = TILE_DRY_GRASS;
      // 30 ripe crops per chunk, deterministically placed.
      for (let p = 0; p < 30; p++) {
        const lx = (p * 7 + 3) % CHUNK_SIZE;
        const ly = (p * 5 + 1) % (CHUNK_SIZE - 2);
        data.tileId[tileIndex(lx, ly)] = WHEAT_BASE;
        data.state[tileIndex(lx, ly)] = CROP_STAGE_HARVESTABLE;
      }
      // One crate per chunk so HARVEST claims have somewhere to deliver.
      // Without this the controller's "no crate found" branch releases
      // every claim and the settler never reaches a path request — the
      // test would pass the cap (zero requests is < cap) but fail the
      // sanity assert (zero requests means stagger isn't even exercised).
      data.tileId[tileIndex(28, 28)] = CRATE_TILE_ID;
      chunks.set(chunkKey(cx, cy), { data, flags: CHUNK_FLAG_DIRTY_RENDER });
    }
  }
  return { chunks, crates: new CrateStore() };
}

function tileWorldFor(world: ReturnType<typeof buildWorld>): TileWorldAccess {
  return {
    readTile(wx, wy) {
      const cx = Math.floor(wx / CHUNK_SIZE);
      const cy = Math.floor(wy / CHUNK_SIZE);
      const rec = world.chunks.get(chunkKey(cx, cy));
      if (!rec) return null;
      const lx = wx - cx * CHUNK_SIZE;
      const ly = wy - cy * CHUNK_SIZE;
      const i = tileIndex(lx, ly);
      return {
        tileId: rec.data.tileId[i] ?? 0,
        state: rec.data.state[i] ?? 0,
        metadata: rec.data.metadata[i] ?? 0,
      };
    },
    harvestAt(wx, wy) {
      const cx = Math.floor(wx / CHUNK_SIZE);
      const cy = Math.floor(wy / CHUNK_SIZE);
      const rec = world.chunks.get(chunkKey(cx, cy));
      if (!rec) return { applied: false };
      const lx = wx - cx * CHUNK_SIZE;
      const ly = wy - cy * CHUNK_SIZE;
      const r = harvestTile(rec.data, lx, ly);
      const out: { applied: boolean; produceItem?: number; yield?: number } = {
        applied: r.applied,
      };
      if (r.produceItem !== undefined) out.produceItem = r.produceItem;
      if (r.yield !== undefined) out.yield = r.yield;
      return out;
    },
    waterAt(wx, wy) {
      const cx = Math.floor(wx / CHUNK_SIZE);
      const cy = Math.floor(wy / CHUNK_SIZE);
      const rec = world.chunks.get(chunkKey(cx, cy));
      if (!rec) return false;
      const lx = wx - cx * CHUNK_SIZE;
      const ly = wy - cy * CHUNK_SIZE;
      return waterTile(rec.data, lx, ly).applied;
    },
    *allChunkRecords() {
      for (const [k, r] of world.chunks) yield [k, r];
    },
  };
}

describe("settler claim stagger", () => {
  test("150-spawn burst caps per-tick path requests well under 150", async () => {
    const world = buildWorld();
    const tw = tileWorldFor(world);
    const board = new JobBoard();
    const fake = new CountingFakeWorker();
    const client = new PathfindingClient({ worker: fake as unknown as Worker });

    const init: Array<{ key: string; mask: Uint8Array }> = [];
    for (const [key, rec] of world.chunks) init.push({ key, mask: buildChunkMask(rec.data) });
    client.initGrid(init);
    await Promise.resolve();
    await Promise.resolve();
    fake.resetTickCounter(); // drop init-time chatter

    const services: EntityServices = {
      jobs: board,
      pathfinding: client,
      crates: world.crates,
      tileWorld: tw,
    };

    // Fill the board so claims can succeed.
    for (let cy = 0; cy < 4; cy++) {
      for (let cx = 0; cx < 4; cx++) {
        for (let p = 0; p < 30; p++) {
          const wx = cx * CHUNK_SIZE + ((p * 7 + 3) % CHUNK_SIZE);
          const wy = cy * CHUNK_SIZE + ((p * 5 + 1) % (CHUNK_SIZE - 2));
          if (tw.readTile(wx, wy)?.tileId === WHEAT_BASE) {
            board.enqueue({
              kind: JOB_KIND_HARVEST_CROP,
              source: { x: wx, y: wy },
              target: { x: wx, y: wy },
              priority: 1,
              payload: 700,
            });
          }
        }
      }
    }

    const em = new EntityManager();
    for (let i = 0; i < 150; i++) {
      const cx = i % 4;
      const cy = Math.floor(i / 4) % 4;
      const lx = ((i * 13) % (CHUNK_SIZE - 2)) + 1;
      const ly = ((i * 7) % (CHUNK_SIZE - 4)) + 1;
      em.add(
        new Villager(
          em.allocateId(),
          { chunkX: cx, chunkY: cy, localX: lx + 0.5, localY: ly + 0.5 },
          `S${i}`,
          { x: cx * CHUNK_SIZE + lx, y: cy * CHUNK_SIZE + ly },
        ),
      );
    }

    const ctx = (time: number, dt: number): EntityTickContext => ({
      time,
      dt,
      worldSeed: 1,
      isWalkable: () => true,
      services,
    });

    // Drive ticks across a window wider than FIRST_CLAIM_STAGGER_SEC (4s)
    // so the spread is fully observed, then a few extra to catch any
    // tail. dt=0.1s × 80 ticks = 8 seconds.
    for (let i = 0; i < 80; i++) {
      em.tick(ctx(i * 0.1, 0.1));
      await Promise.resolve();
      await Promise.resolve();
      fake.resetTickCounter();
    }

    const max = Math.max(...fake.history);
    const total = fake.history.reduce((a, b) => a + b, 0);

    // Hard ceiling: even adversarial bucket pile-up shouldn't push more
    // than ~50 requests in any single tick. Without stagger this would
    // spike to 150 on tick 0.
    expect(max).toBeLessThan(60);
    // Sanity: settlers DID make requests overall (i.e. the stagger isn't
    // accidentally serialising them into permanent idle).
    expect(total).toBeGreaterThan(100);
  }, 30_000);

  test("stagger is deterministic: same id always gets the same first attempt time", async () => {
    // Construct two independent worlds + settler sets; tick both; assert
    // request timing matches per-id.
    const runOnce = async (): Promise<number[]> => {
      const world = buildWorld();
      const tw = tileWorldFor(world);
      const board = new JobBoard();
      const fake = new CountingFakeWorker();
      const client = new PathfindingClient({ worker: fake as unknown as Worker });
      const init: Array<{ key: string; mask: Uint8Array }> = [];
      for (const [key, rec] of world.chunks) init.push({ key, mask: buildChunkMask(rec.data) });
      client.initGrid(init);
      await Promise.resolve();
      await Promise.resolve();
      fake.resetTickCounter();

      const services: EntityServices = {
        jobs: board,
        pathfinding: client,
        crates: world.crates,
        tileWorld: tw,
      };
      // Plenty of jobs.
      for (let cy = 0; cy < 4; cy++) {
        for (let cx = 0; cx < 4; cx++) {
          for (let p = 0; p < 30; p++) {
            const wx = cx * CHUNK_SIZE + ((p * 7 + 3) % CHUNK_SIZE);
            const wy = cy * CHUNK_SIZE + ((p * 5 + 1) % (CHUNK_SIZE - 2));
            if (tw.readTile(wx, wy)?.tileId === WHEAT_BASE) {
              board.enqueue({
                kind: JOB_KIND_HARVEST_CROP,
                source: { x: wx, y: wy },
                target: { x: wx, y: wy },
                priority: 1,
                payload: 700,
              });
            }
          }
        }
      }

      const em = new EntityManager();
      // Use fixed ids so determinism is verifiable.
      for (let i = 0; i < 30; i++) {
        em.add(
          new Villager(
            i + 1,
            { chunkX: 0, chunkY: 0, localX: 1.5, localY: 1.5 },
            `S${i}`,
            { x: 0, y: 0 },
          ),
        );
      }

      const ctx = (time: number, dt: number): EntityTickContext => ({
        time,
        dt,
        worldSeed: 1,
        isWalkable: () => true,
        services,
      });
      for (let i = 0; i < 60; i++) {
        em.tick(ctx(i * 0.1, 0.1));
        await Promise.resolve();
        await Promise.resolve();
        fake.resetTickCounter();
      }
      return fake.history;
    };

    const a = await runOnce();
    const b = await runOnce();
    expect(a).toEqual(b);
  }, 30_000);
});
