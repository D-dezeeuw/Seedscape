// Performance gate for Phase 7. Must complete one tick of 150 settlers
// (each in some active job state) inside the 60fps budget with comfortable
// margin. The test isn't a microbenchmark — it integrates the full tick
// path: state machine, soft-collide spatial hash, fake pathfinding worker.
//
// Budget: average frame must finish in ≤ 6ms. We measure 60 ticks and
// average to smooth out GC noise. The 60fps cap is 16.6ms — the 6ms
// budget reserves room for rendering, sim message dispatch, UI updates,
// and 2-3× headroom for slower hardware than the dev box.

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
const SHALLOW_WATER = 0;

class FakeWorker {
  onmessage: ((ev: MessageEvent<PathfindingResponse>) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  private grid: PathGrid = { masks: new Map() };
  private gridVersion = 0;
  private ws = new PathfinderWorkspace();
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

function buildBigWorld(): {
  chunks: Map<string, ChunkRecord>;
  crates: CrateStore;
} {
  // 4×4 chunks = 128×128 tiles = 16k tiles. Mostly grass, with crops
  // sprinkled around to keep the job board busy. A row of water along
  // the south edge gives every settler a refill source.
  const chunks = new Map<string, ChunkRecord>();
  for (let cy = 0; cy < 4; cy++) {
    for (let cx = 0; cx < 4; cx++) {
      const data = allocChunkData();
      for (let i = 0; i < data.tileId.length; i++) data.tileId[i] = TILE_DRY_GRASS;
      // South edge of southmost row: water.
      if (cy === 3) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          data.tileId[tileIndex(x, CHUNK_SIZE - 1)] = SHALLOW_WATER;
        }
      }
      // Crates dotted across the map.
      data.tileId[tileIndex(2, 2)] = CRATE_TILE_ID;
      // Plant ~30 ripe crops per chunk so harvest jobs are abundant.
      for (let p = 0; p < 30; p++) {
        const lx = (p * 7 + 3) % CHUNK_SIZE;
        const ly = (p * 5 + 1) % (CHUNK_SIZE - 2);
        if (data.tileId[tileIndex(lx, ly)] === TILE_DRY_GRASS) {
          data.tileId[tileIndex(lx, ly)] = WHEAT_BASE;
          data.state[tileIndex(lx, ly)] = CROP_STAGE_HARVESTABLE;
        }
      }
      chunks.set(chunkKey(cx, cy), { data, flags: CHUNK_FLAG_DIRTY_RENDER });
    }
  }
  return { chunks, crates: new CrateStore() };
}

function tileWorldFor(world: ReturnType<typeof buildBigWorld>): TileWorldAccess {
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

describe("150-settler perf gate", () => {
  test("60-tick average tick time is under the 60fps budget", async () => {
    const world = buildBigWorld();
    const tw = tileWorldFor(world);
    const board = new JobBoard();
    const fake = new FakeWorker();
    const client = new PathfindingClient({ worker: fake as unknown as Worker });
    const init: Array<{ key: string; mask: Uint8Array }> = [];
    for (const [key, rec] of world.chunks) init.push({ key, mask: buildChunkMask(rec.data) });
    client.initGrid(init);
    await Promise.resolve();
    await Promise.resolve();

    const services: EntityServices = {
      jobs: board,
      pathfinding: client,
      crates: world.crates,
      tileWorld: tw,
    };

    // Spawn 150 settlers spread across the map.
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

    // Seed a chunky job batch so settlers have something to claim.
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

    const ctx = (time: number, dt: number): EntityTickContext => ({
      time,
      dt,
      worldSeed: 1,
      isWalkable: () => true,
      services,
    });

    // Warmup ticks — let the first round of path requests resolve so the
    // measured window reflects steady-state behaviour, not boot.
    for (let i = 0; i < 30; i++) {
      em.tick(ctx(i * 0.016, 0.016));
      await Promise.resolve();
      await Promise.resolve();
    }

    const TICKS = 60;
    const start = performance.now();
    for (let i = 0; i < TICKS; i++) {
      em.tick(ctx((30 + i) * 0.016, 0.016));
      await Promise.resolve();
      await Promise.resolve();
    }
    const elapsed = performance.now() - start;
    const avgMs = elapsed / TICKS;

    // We hold the gate at 6ms (≈37% of a 16.6ms frame). If this fails on
    // a slow CI box the budget can be relaxed, but the *trend* — drift
    // upward over time — is what to watch.
    expect(avgMs).toBeLessThan(6);
  }, 30_000);
});
