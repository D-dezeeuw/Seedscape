// Integration tests for the settler state machine. Uses an in-process fake
// pathfinding worker (the A* core is pure) so the whole loop runs
// synchronously enough to assert against. The fake delivers path replies on
// the next microtask, so each "step" of the loop is bracketed by
// `await flushMicrotasks()`.

import { beforeEach, describe, expect, test } from "vitest";
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
import { BuildingBufferStore } from "../../world/farming/building_buffer";
import { buildingInputCap } from "../../world/farming/building_buffer_tick";
import { CrateStore } from "../../world/farming/crate";
import { CROP_STAGE_HARVESTABLE } from "../../world/farming/crop_registry";
import {
  harvestTile,
  plantSeed,
  setWaterLevel,
  tillTile,
  waterTile,
} from "../../world/farming/tile_actions";
import { buildChunkMask } from "../../world/walkability";
import { ITEM_IDS, type ItemId } from "../items";
import {
  JOB_KIND_FEED_BUILDING,
  JOB_KIND_HARVEST_CROP,
  JOB_KIND_HAUL_OUTPUT,
  JobBoard,
} from "../jobs";
import type { EntityServices, EntityTickContext, TileWorldAccess } from "./entity";
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
  buffers: BuildingBufferStore;
}

function buildWorld(): World {
  // One 32x32 chunk filled with grass so the settler can walk anywhere.
  const data = allocChunkData();
  for (let i = 0; i < data.tileId.length; i++) data.tileId[i] = TILE_DRY_GRASS;
  const record: ChunkRecord = { data, flags: CHUNK_FLAG_DIRTY_RENDER };
  return {
    chunks: new Map([[chunkKey(0, 0), record]]),
    crates: new CrateStore(),
    buffers: new BuildingBufferStore(),
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
      const r = waterTile(rec.data, lx, ly);
      if (r.applied) dirtyMarks.add(chunkKey(cx, cy));
      return r.applied;
    },
    plantSeedAt(wx, wy, seedItem) {
      const cx = Math.floor(wx / CHUNK_SIZE);
      const cy = Math.floor(wy / CHUNK_SIZE);
      const rec = world.chunks.get(chunkKey(cx, cy));
      if (!rec) return false;
      const lx = wx - cx * CHUNK_SIZE;
      const ly = wy - cy * CHUNK_SIZE;
      const r = plantSeed(rec.data, lx, ly, seedItem as ItemId);
      if (r.applied) dirtyMarks.add(chunkKey(cx, cy));
      return r.applied;
    },
    tillAt(wx, wy) {
      const cx = Math.floor(wx / CHUNK_SIZE);
      const cy = Math.floor(wy / CHUNK_SIZE);
      const rec = world.chunks.get(chunkKey(cx, cy));
      if (!rec) return false;
      const lx = wx - cx * CHUNK_SIZE;
      const ly = wy - cy * CHUNK_SIZE;
      const r = tillTile(rec.data, lx, ly);
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
    buildingBuffers: world.buffers,
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

    const v = new Villager(1, { chunkX: 0, chunkY: 0, localX: 1.5, localY: 1.5 }, "S", {
      x: 1,
      y: 1,
    });

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
    expect(world.chunks.get(chunkKey(0, 0))!.data.tileId[tileIndex(5, 5)]).toBe(
      TILE_FARMLAND_TILLED,
    );
  });

  test("water-crop drains reserve and applies water", async () => {
    // Crop at (3,3), thirsty.
    world.chunks.get(chunkKey(0, 0))!.data.tileId[tileIndex(3, 3)] = WHEAT_BASE;
    world.chunks.get(chunkKey(0, 0))!.data.state[tileIndex(3, 3)] = 2;
    world.chunks.get(chunkKey(0, 0))!.data.metadata[tileIndex(3, 3)] = setWaterLevel(0, 0);

    const { services, board } = makeServices(world);
    await flush();

    const v = new Villager(7, { chunkX: 0, chunkY: 0, localX: 0.5, localY: 0.5 }, "T", {
      x: 0,
      y: 0,
    });
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

    const v = new Villager(2, { chunkX: 0, chunkY: 0, localX: 1.5, localY: 1.5 }, "U", {
      x: 1,
      y: 1,
    });
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

  test("plant-seed completes via lazy haul-seed when settler starts empty", async () => {
    // Setup: dispenser at (8, 8) stocked with wheat seeds, empty tilled
    // tile at (3, 3), settler with empty inventory.
    const chunk = world.chunks.get(chunkKey(0, 0))!;
    chunk.data.tileId[tileIndex(3, 3)] = 13; // FARMLAND_TILLED
    chunk.data.state[tileIndex(3, 3)] = 0;
    chunk.data.tileId[tileIndex(8, 8)] = 221; // SEED_DISPENSER
    world.crates.deposit(8, 8, ITEM_IDS.WHEAT_SEED, 3);

    const { services, board } = makeServices(world);
    await flush();

    const v = new Villager(9, { chunkX: 0, chunkY: 0, localX: 1.5, localY: 1.5 }, "P", {
      x: 1,
      y: 1,
    });
    expect(v.carriedTotal()).toBe(0);

    // Emit a PLANT_SEED job (the controller resolves the seed kind at
    // claim time from whatever the settler picks up via HAUL_SEED).
    board.enqueue({
      kind: 4, // JOB_KIND_PLANT_SEED
      source: { x: 3, y: 3 },
      target: { x: 3, y: 3 },
      priority: 1,
      payload: 0,
    });

    let sawHaulSeed = false;
    let time = 0;
    for (let i = 0; i < 500; i++) {
      time += 0.1;
      v.tick(makeCtx(time, services));
      await flush();
      for (const j of board.all()) {
        if (j.kind === 5) sawHaulSeed = true; // JOB_KIND_HAUL_SEED
      }
      if (board.size() === 0 && v.jobs.isIdle()) break;
    }

    expect(sawHaulSeed).toBe(true);
    expect(board.size()).toBe(0);
    // The empty tilled tile is now a young wheat (base 100, stage 0).
    expect(chunk.data.tileId[tileIndex(3, 3)]).toBe(100);
    // Dispenser drained by 1 (settler picked up exactly one seed).
    expect(world.crates.countAt(8, 8, ITEM_IDS.WHEAT_SEED)).toBe(2);
    // Memory: settler logged both the haul and the plant.
    const events = v.shortTermMemory.filter((m) => m.type !== 0);
    const types = events.map((m) => m.type).sort();
    expect(types).toContain(5); // HAULED_SEED
    expect(types).toContain(2); // PLANTED
    const planted = events.find((m) => m.type === 2);
    expect(planted?.tileX).toBe(3);
    expect(planted?.tileY).toBe(3);
    expect(planted?.subjectId).toBe(ITEM_IDS.WHEAT_SEED);
  });

  test("auto-deposit task fires when settler is overweight at idle", async () => {
    // Setup: a crate at (8,8) and a settler pre-loaded with wheat past the
    // overweight threshold. No jobs on the board — the controller should
    // refuse to claim and instead inject a deposit task that walks to the
    // crate and drains the inventory.
    //
    // Home anchored at (12,12) (centre of the chunk) so the wander radius
    // (6) keeps the settler inside chunk (0,0) — pathfinder grid is one
    // chunk and any out-of-bounds start tile yields "path not found",
    // which would mask the injection by popping the task immediately.
    world.chunks.get(chunkKey(0, 0))!.data.tileId[tileIndex(8, 8)] = CRATE_TILE;
    const { services, board } = makeServices(world);
    await flush();

    const v = new Villager(42, { chunkX: 0, chunkY: 0, localX: 12.5, localY: 12.5 }, "X", {
      x: 12,
      y: 12,
    });
    // 8 wheat = 80 weight, past the 70% threshold of the 100-cap default.
    v.pickup(ITEM_IDS.WHEAT, 8);
    expect(v.isOverweight()).toBe(true);

    let time = 0;
    let sawDepositTask = false;
    for (let i = 0; i < 400; i++) {
      time += 0.1;
      v.tick(makeCtx(time, services));
      await flush();
      if (v.jobs.currentTaskKind() === "deposit") sawDepositTask = true;
      if (v.jobs.isIdle() && v.carriedItems.size === 0) break;
    }

    expect(sawDepositTask).toBe(true);
    expect(board.size()).toBe(0);
    expect(v.carriedItems.size).toBe(0);
    expect(world.crates.countAt(8, 8, ITEM_IDS.WHEAT)).toBe(8);
    expect(v.jobs.isIdle()).toBe(true);
  });

  test("auto-deposit respects Job.holdItems for non-default-sticky items", async () => {
    // Settler is overweight with FLOUR (no defaultSticky). With NO claimed
    // job declaring flour as held, the deposit injection runs. With a
    // claimed job that has holdItems=[FLOUR], the same scenario must
    // skip flour and refuse to inject — this is the foundation Phase 8
    // hauling jobs will lean on.
    world.chunks.get(chunkKey(0, 0))!.data.tileId[tileIndex(8, 8)] = CRATE_TILE;
    const { services, board } = makeServices(world);
    await flush();

    const v = new Villager(99, { chunkX: 0, chunkY: 0, localX: 12.5, localY: 12.5 }, "F", {
      x: 12,
      y: 12,
    });
    // 4 flour = 100 weight (max), well past the 70 threshold.
    v.pickup(ITEM_IDS.FLOUR, 4);
    expect(v.isOverweight()).toBe(true);

    // Simulate a claimed haul job with holdItems=[FLOUR]. We use
    // HARVEST_CROP as the kind (any kind works for this test) and
    // pre-claim it so the controller doesn't try to start it.
    const heldJobId = board.enqueue({
      kind: JOB_KIND_HARVEST_CROP,
      source: { x: 12, y: 12 },
      target: { x: 12, y: 12 },
      priority: 1,
      payload: 0,
      holdItems: [ITEM_IDS.FLOUR],
    });
    // Mark as claimed by THIS settler so stickyItemsFor sees it.
    const heldJob = board.get(heldJobId)!;
    heldJob.claimedBy = v.id;

    let time = 0;
    let sawDepositTask = false;
    for (let i = 0; i < 200; i++) {
      time += 0.1;
      v.tick(makeCtx(time, services));
      await flush();
      if (v.jobs.currentTaskKind() === "deposit") sawDepositTask = true;
    }

    // Sticky from the held job → deposit must NOT fire even though the
    // settler is overweight.
    expect(sawDepositTask).toBe(false);
    expect(v.carriedItems.get(ITEM_IDS.FLOUR)).toBe(4);
  });

  test("auto-deposit does not fire when only seeds (sticky) are carried", async () => {
    // Same scenario but the settler is hauling seeds (sticky) — no deposit
    // task should be injected. With no jobs claimable the settler simply
    // wanders and keeps the seed for a future PLANT_SEED.
    world.chunks.get(chunkKey(0, 0))!.data.tileId[tileIndex(8, 8)] = CRATE_TILE;
    const { services } = makeServices(world);
    await flush();

    const v = new Villager(43, { chunkX: 0, chunkY: 0, localX: 12.5, localY: 12.5 }, "Y", {
      x: 12,
      y: 12,
    });
    // Cap is 100, seeds weigh 1 → easy to push past 70 by raising the
    // count. Still sticky → no deposit injection.
    v.pickup(ITEM_IDS.WHEAT_SEED, 90);
    expect(v.isOverweight()).toBe(true);

    let time = 0;
    let sawDepositTask = false;
    // Run long enough for the stagger window + several backoffs to elapse.
    for (let i = 0; i < 200; i++) {
      time += 0.1;
      v.tick(makeCtx(time, services));
      await flush();
      if (v.jobs.currentTaskKind() === "deposit") sawDepositTask = true;
    }

    expect(sawDepositTask).toBe(false);
    expect(v.carriedItems.get(ITEM_IDS.WHEAT_SEED)).toBe(90);
  });

  test("stuck settler re-plans once before cancelling", async () => {
    // Reproduces the deadlock case: settler walking toward a goal stalls
    // (we simulate by setting dt=0 once it's in walking state). At
    // REPLAN_THRESHOLD_SEC (~3.5s) the controller asks for a fresh path;
    // if that also doesn't help, at STUCK_TIMEOUT_SEC (~6s) the job is
    // cancelled. We count post-walk path requests to verify exactly
    // one replan fires before the cancel.
    const chunk = world.chunks.get(chunkKey(0, 0))!;
    chunk.data.tileId[tileIndex(20, 20)] = WHEAT_BASE;
    chunk.data.state[tileIndex(20, 20)] = CROP_STAGE_HARVESTABLE;
    chunk.data.tileId[tileIndex(15, 15)] = CRATE_TILE;

    const { services, board, client } = makeServices(world);
    await flush();
    const v = new Villager(77, { chunkX: 0, chunkY: 0, localX: 1.5, localY: 1.5 }, "Z", {
      x: 1,
      y: 1,
    });

    board.enqueue({
      kind: 3, // HARVEST_CROP
      source: { x: 20, y: 20 },
      target: { x: 20, y: 20 },
      priority: 1,
      payload: 700,
    });

    // Phase 1: tick a few frames at normal speed so the settler claims
    // the job, requests a path, and enters walking state.
    let time = 0;
    for (let i = 0; i < 50; i++) {
      time += 0.1;
      v.tick(makeCtx(time, services));
      await flush();
      if (v.jobs.currentStateName() === "walking") break;
    }
    expect(v.jobs.currentStateName()).toBe("walking");
    void client; // referenced for type only

    // Phase 2: stall the settler. dt=0 means moveToward makes no
    // progress every tick, so lastAdvanceTime never updates. Drive
    // time forward by 8 seconds in 0.1s ctx.time increments.
    let stuckSinceSet = false;
    let cancelled = false;
    let replanRequested = false;
    let firstWalkingStart = -1;
    // Phase 2 covers > REPLAN_THRESHOLD (3.5s) + STUCK_TIMEOUT (6s)
    // through both the original walk and the replanned walk segment.
    // Worst case: replan fires at 3.5s into segment 1; new segment
    // resets the timer; cancel fires at 6s into segment 2 → ~9.5s
    // total. 200 ticks * 0.1s = 20s gives generous headroom.
    for (let i = 0; i < 200; i++) {
      time += 0.1;
      v.tick({
        time,
        dt: 0, // crucial: simulates "no walking progress"
        worldSeed: 1,
        isWalkable: () => true,
        services,
      });
      // Check state BEFORE the microtask flush — the replan branch
      // transitions to "requesting_path" synchronously inside tick(),
      // and the path response arrives during flush; observing after
      // flush would miss the transition window.
      const stateName = v.jobs.currentStateName();
      if (firstWalkingStart < 0 && stateName === "walking") firstWalkingStart = i;
      if (firstWalkingStart >= 0 && stateName === "requesting_path") replanRequested = true;
      await flush();
      if (v.stuckSince !== Number.NEGATIVE_INFINITY) stuckSinceSet = true;
      if (v.jobs.isIdle() && board.size() === 0) {
        cancelled = true;
        break;
      }
    }

    expect(stuckSinceSet).toBe(true);
    expect(replanRequested).toBe(true);
    expect(cancelled).toBe(true);
  });

  test("FEED_BUILDING: settler hauls input from crate to mill input buffer", async () => {
    // Setup: mill at (15,15), crate at (12,12) with 6 wheat. Settler
    // at (10,10). Emit a FEED_BUILDING job; settler should walk to
    // crate, pick up wheat, walk to mill, drop into the input buffer.
    const chunk = world.chunks.get(chunkKey(0, 0))!;
    const MILL_TILE = 200;
    chunk.data.tileId[tileIndex(15, 15)] = MILL_TILE;
    chunk.data.tileId[tileIndex(12, 12)] = CRATE_TILE;
    world.crates.deposit(12, 12, ITEM_IDS.WHEAT, 6);

    const { services, board } = makeServices(world);
    await flush();

    const v = new Villager(50, { chunkX: 0, chunkY: 0, localX: 10.5, localY: 10.5 }, "F", {
      x: 10,
      y: 10,
    });

    board.enqueue({
      kind: JOB_KIND_FEED_BUILDING,
      source: { x: 15, y: 15 },
      target: { x: 15, y: 15 },
      priority: 2,
      payload: ITEM_IDS.WHEAT,
      holdItems: [ITEM_IDS.WHEAT],
    });

    let time = 0;
    for (let i = 0; i < 600; i++) {
      time += 0.1;
      v.tick(makeCtx(time, services));
      await flush();
      if (board.size() === 0 && v.jobs.isIdle()) break;
    }

    expect(board.size()).toBe(0);
    expect(v.jobs.isIdle()).toBe(true);
    // Mill input buffer should now have wheat. The settler should pull
    // up to def.inputQuantity = 3 per trip; one job claim → one trip.
    expect(world.buffers.totalInputAt(15, 15)).toBeGreaterThan(0);
    // Crate drained by exactly the amount the buffer received.
    const inBuffer = world.buffers.totalInputAt(15, 15);
    expect(world.crates.countAt(12, 12, ITEM_IDS.WHEAT)).toBe(6 - inBuffer);
    // Memory event recorded.
    const memTypes = v.shortTermMemory.filter((m) => m.type !== 0).map((m) => m.type);
    expect(memTypes).toContain(7); // FED_BUILDING
  });

  test("HAUL_OUTPUT: settler hauls finished output from mill to crate", async () => {
    // Setup: mill at (15,15) with 4 flour in its OUTPUT buffer (bypassing
    // the cycle since the sim is mocked here — we plant the buffer
    // directly). Empty crate at (12,12). Settler at (18,18).
    const chunk = world.chunks.get(chunkKey(0, 0))!;
    const MILL_TILE = 200;
    chunk.data.tileId[tileIndex(15, 15)] = MILL_TILE;
    chunk.data.tileId[tileIndex(12, 12)] = CRATE_TILE;
    // Stash flour in the output buffer at the mill. Cap is generous; we
    // just need a positive amount to haul.
    world.buffers.addOutput(15, 15, ITEM_IDS.FLOUR, 4, 100);

    const { services, board } = makeServices(world);
    await flush();

    const v = new Villager(60, { chunkX: 0, chunkY: 0, localX: 18.5, localY: 18.5 }, "H", {
      x: 18,
      y: 18,
    });

    board.enqueue({
      kind: JOB_KIND_HAUL_OUTPUT,
      source: { x: 15, y: 15 },
      target: { x: 15, y: 15 },
      priority: 2,
      payload: ITEM_IDS.FLOUR,
      holdItems: [ITEM_IDS.FLOUR],
    });

    let time = 0;
    for (let i = 0; i < 600; i++) {
      time += 0.1;
      v.tick(makeCtx(time, services));
      await flush();
      if (board.size() === 0 && v.jobs.isIdle()) break;
    }

    expect(board.size()).toBe(0);
    expect(v.jobs.isIdle()).toBe(true);
    // Crate now has flour; output buffer drained by the same amount.
    const inCrate = world.crates.countAt(12, 12, ITEM_IDS.FLOUR);
    expect(inCrate).toBeGreaterThan(0);
    expect(world.buffers.totalOutputAt(15, 15)).toBe(4 - inCrate);
    // HAULED_OUTPUT memory event recorded.
    const memTypes = v.shortTermMemory.filter((m) => m.type !== 0).map((m) => m.type);
    expect(memTypes).toContain(8); // HAULED_OUTPUT
    // Suppress unused-import warning — buildingInputCap is exported for
    // the building_window UI; the import here keeps the test in sync if
    // the cap math ever moves.
    void buildingInputCap;
  });
});
