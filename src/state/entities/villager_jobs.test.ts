// Integration tests for the settler state machine. Uses an in-process fake
// pathfinding worker (the A* core is pure) so the whole loop runs
// synchronously enough to assert against. The fake delivers path replies on
// the next microtask, so each "step" of the loop is bracketed by
// `await flushMicrotasks()`.

import { beforeEach, describe, expect, test } from "vitest";
import {
  allocChunkData,
  CHUNK_FLAG_DIRTY_RENDER,
  CHUNK_SIZE,
  type ChunkRecord,
  tileIndex,
} from "../../world/chunk";
import { chunkKey } from "../../world/coords";
import { CrateStore } from "../../world/farming/crate";
import { CROP_STAGE_HARVESTABLE } from "../../world/farming/crop_registry";
import { harvestTile, setWaterLevel, waterTile } from "../../world/farming/tile_actions";
import { buildChunkMask } from "../../world/walkability";
import { PathfindingClient } from "../../workers/pathfinding_client";
import {
  findPath,
  type PathGrid,
  PathfinderWorkspace,
} from "../../workers/pathfinding_core";
import type {
  PathfindingRequest,
  PathfindingResponse,
} from "../../workers/pathfinding_worker";
import { ITEM_IDS } from "../items";
import { JOB_KIND_HARVEST_CROP, JobBoard } from "../jobs";
import type {
  EntityServices,
  EntityTickContext,
  TileWorldAccess,
} from "./entity";
import { Villager } from "./villager";

const WHEAT_BASE = 100;
const TILE_FARMLAND_TILLED = 13;
const TILE_DRY_GRASS = 10;
const SHALLOW_WATER = 0;
const CRATE_TILE = 220;

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

interface World {
  chunks: Map<string, ChunkRecord>;
  crates: CrateStore;
}

function buildWorld(): World {
  // One 32x32 chunk filled with grass so the settler can walk anywhere.
  const data = allocChunkData();
  for (let i = 0; i < data.tileId.length; i++) data.tileId[i] = TILE_DRY_GRASS;
  const record: ChunkRecord = { data, flags: CHUNK_FLAG_DIRTY_RENDER };
  return {
    chunks: new Map([[chunkKey(0, 0), record]]),
    crates: new CrateStore(),
  };
}

function tileWorldFor(world: World, dirtyMarks: Set<string>): TileWorldAccess {
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
      if (r.applied) dirtyMarks.add(chunkKey(cx, cy));
      const out: { applied: boolean; produceItem?: number; yield?: number } = { applied: r.applied };
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
      const r = waterTile(rec.data, lx, ly);
      if (r.applied) dirtyMarks.add(chunkKey(cx, cy));
      return r.applied;
    },
    *allChunkRecords() {
      for (const [k, r] of world.chunks) yield [k, r];
    },
  };
}

async function flush(): Promise<void> {
  // Two microtask flushes so the path response is delivered AND the
  // .then handler that updates state has run.
  await Promise.resolve();
  await Promise.resolve();
}

function makeServices(world: World): {
  services: EntityServices;
  client: PathfindingClient;
  board: JobBoard;
} {
  const board = new JobBoard();
  const fake = new FakeWorker();
  const client = new PathfindingClient({ worker: fake as unknown as Worker });
  // Initialize grid from world.
  const init: Array<{ key: string; mask: Uint8Array }> = [];
  for (const [key, rec] of world.chunks) init.push({ key, mask: buildChunkMask(rec.data) });
  client.initGrid(init);
  const dirty = new Set<string>();
  const services: EntityServices = {
    jobs: board,
    pathfinding: client,
    crates: world.crates,
    tileWorld: tileWorldFor(world, dirty),
  };
  return { services, client, board };
}

function makeCtx(time: number, services: EntityServices, dt = 0.1): EntityTickContext {
  return {
    time,
    dt,
    worldSeed: 1,
    isWalkable: () => true,
    services,
  };
}

describe("VillagerJobController integration", () => {
  let world: World;

  beforeEach(() => {
    world = buildWorld();
  });

  test("harvest-and-deposit completes end to end", async () => {
    // Setup: ripe wheat at (5,5), crate at (8,8), settler at (1,1).
    // Note: we mark the crate tile (id 220) but leave the world
    // walkability mask reflecting only the test chunk (filled with grass)
    // because nearestCrateWithRoom needs to *find* the crate tile by id.
    // The pathfinder still walks to the crate tile because we initialised
    // its mask before adding the crate id (which would block it).
    world.chunks.get(chunkKey(0, 0))!.data.tileId[tileIndex(5, 5)] = WHEAT_BASE;
    world.chunks.get(chunkKey(0, 0))!.data.state[tileIndex(5, 5)] = CROP_STAGE_HARVESTABLE;
    world.chunks.get(chunkKey(0, 0))!.data.tileId[tileIndex(8, 8)] = CRATE_TILE;

    const { services, board } = makeServices(world);
    await flush();

    const v = new Villager(
      1,
      { chunkX: 0, chunkY: 0, localX: 1.5, localY: 1.5 },
      "S",
      { x: 1, y: 1 },
    );

    // Emit a HARVEST job manually (we're not exercising the emitter here).
    board.enqueue({
      kind: JOB_KIND_HARVEST_CROP,
      source: { x: 5, y: 5 },
      target: { x: 5, y: 5 }, // controller resolves to crate at claim
      priority: 1,
      payload: ITEM_IDS.WHEAT,
    });

    // Run for enough sim time. Step at 0.1s per tick, 200 ticks = 20s.
    let time = 0;
    for (let i = 0; i < 400; i++) {
      time += 0.1;
      v.tick(makeCtx(time, services));
      await flush();
      if (board.size() === 0 && v.jobs.isIdle()) break;
    }

    // Job complete; settler is idle; crate has the produce.
    expect(board.size()).toBe(0);
    expect(v.jobs.isIdle()).toBe(true);
    expect(world.crates.countAt(8, 8, ITEM_IDS.WHEAT)).toBeGreaterThan(0);
    // Source crop reverts to tilled.
    expect(world.chunks.get(chunkKey(0, 0))!.data.tileId[tileIndex(5, 5)]).toBe(TILE_FARMLAND_TILLED);
  });

  test("water-crop drains reserve and applies water", async () => {
    // Crop at (3,3), thirsty.
    world.chunks.get(chunkKey(0, 0))!.data.tileId[tileIndex(3, 3)] = WHEAT_BASE;
    world.chunks.get(chunkKey(0, 0))!.data.state[tileIndex(3, 3)] = 2;
    world.chunks.get(chunkKey(0, 0))!.data.metadata[tileIndex(3, 3)] = setWaterLevel(0, 0);

    const { services, board } = makeServices(world);
    await flush();

    const v = new Villager(
      7,
      { chunkX: 0, chunkY: 0, localX: 0.5, localY: 0.5 },
      "T",
      { x: 0, y: 0 },
    );
    v.waterReserve = 3;

    board.enqueue({
      kind: 2, // WATER_CROP
      source: { x: 3, y: 3 },
      target: { x: 3, y: 3 },
      priority: 1,
      payload: 0,
    });

    let time = 0;
    for (let i = 0; i < 400; i++) {
      time += 0.1;
      v.tick(makeCtx(time, services));
      await flush();
      if (board.size() === 0 && v.jobs.isIdle()) break;
    }

    expect(board.size()).toBe(0);
    expect(v.waterReserve).toBe(2); // drained by 1
    const meta = world.chunks.get(chunkKey(0, 0))!.data.metadata[tileIndex(3, 3)] as number;
    const water = (meta >> 3) & 0b11;
    expect(water).toBe(3); // refilled to max
  });

  test("haul-water spawns implicit job when reserve is empty and crops are dry", async () => {
    // Thirsty crop forces emitter-side WATER_CROP, which the settler will
    // see and trigger a HAUL_WATER for itself.
    world.chunks.get(chunkKey(0, 0))!.data.tileId[tileIndex(10, 10)] = WHEAT_BASE;
    world.chunks.get(chunkKey(0, 0))!.data.state[tileIndex(10, 10)] = 2;
    world.chunks.get(chunkKey(0, 0))!.data.metadata[tileIndex(10, 10)] = setWaterLevel(0, 0);
    // Water tile within reach.
    world.chunks.get(chunkKey(0, 0))!.data.tileId[tileIndex(5, 5)] = SHALLOW_WATER;

    const { services, board } = makeServices(world);
    await flush();

    // Emit the water-crop job (would normally come from JobEmitter).
    board.enqueue({
      kind: 2,
      source: { x: 10, y: 10 },
      target: { x: 10, y: 10 },
      priority: 2,
      payload: 0,
    });

    const v = new Villager(
      2,
      { chunkX: 0, chunkY: 0, localX: 1.5, localY: 1.5 },
      "U",
      { x: 1, y: 1 },
    );
    expect(v.waterReserve).toBe(0);

    let time = 0;
    let sawHaul = false;
    for (let i = 0; i < 400; i++) {
      time += 0.1;
      v.tick(makeCtx(time, services));
      await flush();
      // Did the settler spawn a HAUL_WATER for itself?
      for (const j of board.all()) {
        if (j.kind === 1) sawHaul = true;
      }
      if (v.waterReserve > 0) break;
    }
    expect(sawHaul).toBe(true);
    expect(v.waterReserve).toBe(5); // refilled to MAX_WATER_RESERVE
  });

  test("falls back to wander when no job is available", async () => {
    const { services } = makeServices(world);
    await flush();

    const v = new Villager(3, { chunkX: 0, chunkY: 0, localX: 5.5, localY: 5.5 }, "Q", {
      x: 5,
      y: 5,
    });
    const startX = v.worldX();
    const startY = v.worldY();

    let time = 0;
    for (let i = 0; i < 50; i++) {
      time += 0.1;
      v.tick(makeCtx(time, services));
      await flush();
    }
    // Wander should have produced some movement.
    const moved = Math.abs(v.worldX() - startX) + Math.abs(v.worldY() - startY);
    expect(moved).toBeGreaterThan(0);
  });
});
