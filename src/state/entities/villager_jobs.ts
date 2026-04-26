// Settler job state machine. Owns one Villager's autonomy: claim a job,
// request a path to its source, walk the path, act, optionally walk to a
// target (crate for HARVEST), act again, complete. On failure (path not
// found, source vanished mid-flight, stuck for too long) the controller
// cancels the job so another settler can pick it up later.
//
// Path requests are async. The controller stores them with a request ID;
// when the promise resolves, the .then handler updates the controller's
// state (only if the request is still the one the settler is waiting for).
//
// The controller is intentionally keyed off the Villager — it does not
// reach into other entities or globals. Tests construct a Villager + a
// fake services object and call tick() in a loop.

import { CRATE_TILE_ID } from "../../world/farming/crate";
import {
  CROP_STAGE_HARVESTABLE,
  CROP_STATE_WILTED,
  cropForTile,
} from "../../world/farming/crop_registry";
import { findNearestWaterSource } from "../../world/farming/water_finder";
import { isWaterSource } from "../../world/walkability";
import {
  JOB_KIND_HARVEST_CROP,
  JOB_KIND_HAUL_WATER,
  JOB_KIND_WATER_CROP,
  type Job,
  type JobKind,
} from "../jobs";
import type { EntityServices, EntityTickContext } from "./entity";
import { MAX_WATER_RESERVE, type Villager } from "./villager";

// Tunables. Adjusted to feel responsive without a setter.
const WALK_SPEED_TILES_PER_SEC = 4;
const ARRIVE_EPSILON = 0.1;
// Seconds the settler stays put on each act tile (harvest, water, deposit).
const ACT_DURATION_SEC = 0.6;
// If the settler hasn't advanced a waypoint for this long, give up — the
// path is probably blocked by something the planner didn't see (other
// settler, transient state). Cancelling lets a re-emit pick it up later.
const STUCK_TIMEOUT_SEC = 5;

type Phase = "to_source" | "to_target";

type ControllerState =
  | { kind: "idle" }
  | { kind: "requesting_path"; jobId: number; phase: Phase; requestNonce: number }
  | {
      kind: "walking";
      jobId: number;
      phase: Phase;
      // Waypoints stored flat: x0,y0,x1,y1,...
      waypoints: Int16Array;
      idx: number;
      // Last time we advanced a waypoint. If now - lastAdvance > timeout, give up.
      lastAdvanceTime: number;
    }
  | { kind: "acting"; jobId: number; phase: Phase; until: number }
  | { kind: "no_op" };

export class VillagerJobController {
  private state: ControllerState = { kind: "idle" };
  // Monotonic request id so async path replies that arrive after a
  // re-plan or job cancel can be discarded.
  private nextNonce = 1;

  // Inspect helpers (debug UI, tests).
  currentJobId(): number | null {
    if (this.state.kind === "idle" || this.state.kind === "no_op") return null;
    return this.state.jobId;
  }
  currentWaypoints(): Int16Array | null {
    return this.state.kind === "walking" ? this.state.waypoints : null;
  }
  currentWaypointIdx(): number | null {
    return this.state.kind === "walking" ? this.state.idx : null;
  }
  currentPhase(): Phase | null {
    if (this.state.kind === "idle" || this.state.kind === "no_op") return null;
    return this.state.phase;
  }
  currentStateName(): string {
    return this.state.kind;
  }
  isIdle(): boolean {
    return this.state.kind === "idle";
  }

  // Drop any active job back on the board (without removing it). Called
  // when the controlling entity is removed or the settler is being
  // possessed by the player and we want to suspend autonomy cleanly.
  abandon(services: EntityServices | undefined): void {
    if (this.state.kind === "idle" || this.state.kind === "no_op") return;
    if (services?.jobs) services.jobs.release(this.state.jobId);
    this.state = { kind: "idle" };
  }

  // Run one tick of the state machine. Returns true if the controller
  // handled the tick (settler is busy with a job); false if idle and the
  // caller should fall through to wander/whatever default behaviour.
  tick(v: Villager, ctx: EntityTickContext, services: EntityServices): boolean {
    // Narrow services here so subsequent helpers can read services.tileWorld
    // etc. without optional chaining or non-null assertions on every line.
    if (!services.jobs || !services.pathfinding || !services.tileWorld) return false;

    switch (this.state.kind) {
      case "idle":
        return this.tickIdle(v, ctx, services);
      case "requesting_path":
        // Nothing to do until the promise resolves; just hold the slot.
        return true;
      case "walking":
        return this.tickWalking(v, ctx, services);
      case "acting":
        return this.tickActing(v, ctx, services);
      case "no_op":
        return false;
    }
  }

  private tickIdle(v: Villager, ctx: EntityTickContext, services: EntityServices): boolean {
    const board = services.jobs;
    if (!board) return false;
    const fromX = v.worldTileX();
    const fromY = v.worldTileY();

    // Preference: if reserve > 0, both kinds are claimable. If reserve === 0,
    // skip WATER_CROP (we'd just need to get water first) and prefer HARVEST.
    const kinds: ReadonlyArray<JobKind> =
      v.waterReserve > 0
        ? [JOB_KIND_WATER_CROP, JOB_KIND_HARVEST_CROP, JOB_KIND_HAUL_WATER]
        : [JOB_KIND_HARVEST_CROP, JOB_KIND_HAUL_WATER];

    let job = board.claim(v.id, { kinds, fromX, fromY });

    // No claimable job. If the world has thirsty crops and we're empty,
    // emit a HAUL_WATER for ourselves so the next claim succeeds.
    const tileWorld = services.tileWorld;
    if (!tileWorld) return false;
    if (!job && v.waterReserve === 0 && hasUnclaimedWaterJob(board)) {
      const water = findNearestWaterSource(tileWorld, fromX, fromY);
      if (water) {
        const id = board.enqueue({
          kind: JOB_KIND_HAUL_WATER,
          // Source/target both refer to the standing tile so existing
          // walk-and-act flow works unchanged. The water tile itself is
          // also recorded as the *payload* of the job (via target.x/y
          // being the standing tile and source.x/y the water tile would
          // confuse the dedup; instead we point both at standing).
          source: { x: water.standing.x, y: water.standing.y },
          target: { x: water.standing.x, y: water.standing.y },
          priority: 5,
          payload: 0,
        });
        job = board.claim(v.id, { fromX, fromY });
        if (!job || job.id !== id) {
          // Another settler grabbed it first — drop the duplicate so we
          // don't leak unowned jobs.
          if (job) board.release(job.id);
          return false;
        }
      }
    }

    if (!job) return false;

    // HARVEST_CROP: pick a destination crate now so we know where to
    // deliver. If no crate exists, cancel the claim — without storage,
    // we have nowhere to put produce. job.target stores the *standing*
    // tile next to the crate; act_at_target scans neighbours for the
    // CRATE_TILE_ID to find the crate itself.
    if (job.kind === JOB_KIND_HARVEST_CROP) {
      const hit =
        services.crates && services.tileWorld
          ? services.crates.nearestCrateWithRoom(services.tileWorld, job.source.x, job.source.y)
          : null;
      if (!hit) {
        board.release(job.id);
        return false;
      }
      job.target = hit.standing;
    }

    // Verify the source tile still matches what was emitted. Player
    // actions or sim ticks could have changed it (harvested the crop,
    // built over the water tile). Re-emit will pick it up next scan.
    if (!sourceStillValid(job, services)) {
      board.cancel(job.id, "stale source");
      return false;
    }

    this.requestPathToSource(v, ctx, services, job);
    return true;
  }

  private requestPathToSource(
    v: Villager,
    ctx: EntityTickContext,
    services: EntityServices,
    job: Job,
  ): void {
    const pathfinding = services.pathfinding;
    if (!pathfinding) return;
    const nonce = this.nextNonce++;
    this.state = {
      kind: "requesting_path",
      jobId: job.id,
      phase: "to_source",
      requestNonce: nonce,
    };
    pathfinding
      .requestPath({ x: v.worldTileX(), y: v.worldTileY() }, { x: job.source.x, y: job.source.y })
      .then((reply) => this.onPathReply(nonce, "to_source", reply.waypoints, services, ctx.time))
      .catch(() => this.onPathFailed(nonce, services));
  }

  private requestPathToTarget(
    v: Villager,
    ctx: EntityTickContext,
    services: EntityServices,
    job: Job,
  ): void {
    const pathfinding = services.pathfinding;
    if (!pathfinding) return;
    const nonce = this.nextNonce++;
    this.state = {
      kind: "requesting_path",
      jobId: job.id,
      phase: "to_target",
      requestNonce: nonce,
    };
    pathfinding
      .requestPath({ x: v.worldTileX(), y: v.worldTileY() }, { x: job.target.x, y: job.target.y })
      .then((reply) => this.onPathReply(nonce, "to_target", reply.waypoints, services, ctx.time))
      .catch(() => this.onPathFailed(nonce, services));
  }

  private onPathReply(
    nonce: number,
    phase: Phase,
    waypoints: Int16Array,
    services: EntityServices,
    nowTime: number,
  ): void {
    if (this.state.kind !== "requesting_path") return;
    if (this.state.requestNonce !== nonce) return; // stale; we re-planned
    const jobId = this.state.jobId;
    if (waypoints.length < 2) {
      // Path not found.
      services.jobs?.cancel(jobId, "path not found");
      this.state = { kind: "idle" };
      return;
    }
    this.state = {
      kind: "walking",
      jobId,
      phase,
      waypoints,
      // Skip waypoints[0] — that's the start tile we're already on.
      idx: 2,
      lastAdvanceTime: nowTime,
    };
  }

  private onPathFailed(nonce: number, services: EntityServices): void {
    if (this.state.kind !== "requesting_path") return;
    if (this.state.requestNonce !== nonce) return;
    services.jobs?.cancel(this.state.jobId, "path request rejected");
    this.state = { kind: "idle" };
  }

  private tickWalking(v: Villager, ctx: EntityTickContext, services: EntityServices): boolean {
    if (this.state.kind !== "walking") return true;
    const wp = this.state.waypoints;
    if (this.state.idx >= wp.length) {
      // Reached end of waypoints — should have transitioned out already.
      return this.advanceToActing(v, ctx, services);
    }
    const tx = (wp[this.state.idx] as number) + 0.5;
    const ty = (wp[this.state.idx + 1] as number) + 0.5;
    const remaining = v.moveToward(tx, ty, WALK_SPEED_TILES_PER_SEC, ctx.dt, ctx.isWalkable);
    if (remaining < ARRIVE_EPSILON) {
      this.state.idx += 2;
      this.state.lastAdvanceTime = ctx.time;
      if (this.state.idx >= wp.length) {
        return this.advanceToActing(v, ctx, services);
      }
    } else if (ctx.time - this.state.lastAdvanceTime > STUCK_TIMEOUT_SEC) {
      // Stuck. Cancel — re-emit will reschedule if still relevant.
      services.jobs?.cancel(this.state.jobId, "stuck");
      this.state = { kind: "idle" };
    }
    return true;
  }

  private advanceToActing(
    _v: Villager,
    ctx: EntityTickContext,
    _services: EntityServices,
  ): boolean {
    if (this.state.kind !== "walking") return true;
    this.state = {
      kind: "acting",
      jobId: this.state.jobId,
      phase: this.state.phase,
      until: ctx.time + ACT_DURATION_SEC,
    };
    return true;
  }

  private tickActing(v: Villager, ctx: EntityTickContext, services: EntityServices): boolean {
    if (this.state.kind !== "acting") return true;
    if (ctx.time < this.state.until) return true;

    const board = services.jobs;
    if (!board) return true;
    const job = board.get(this.state.jobId);
    if (!job) {
      // Job was cancelled out from under us (e.g., crash recovery);
      // settle back to idle.
      this.state = { kind: "idle" };
      return true;
    }

    if (this.state.phase === "to_source") {
      this.actAtSource(v, ctx, services, job);
      // After source act:
      //   - if target === source → complete
      //   - else → walk to target
      if (sameTile(job.source, job.target)) {
        board.complete(job.id);
        this.state = { kind: "idle" };
      } else {
        this.requestPathToTarget(v, ctx, services, job);
      }
      return true;
    }

    // phase === "to_target"
    this.actAtTarget(v, ctx, services, job);
    board.complete(job.id);
    this.state = { kind: "idle" };
    return true;
  }

  private actAtSource(
    v: Villager,
    _ctx: EntityTickContext,
    services: EntityServices,
    job: Job,
  ): void {
    const tw = services.tileWorld;
    if (!tw) return;
    switch (job.kind) {
      case JOB_KIND_HAUL_WATER: {
        // Settler stands on a tile adjacent to a water source; refill from
        // the closest neighbour that is one. We re-derive instead of
        // trusting the job payload so a player who built a well right next
        // to the settler can still be used as an alternate.
        for (const n of fourNeighbours(job.source.x, job.source.y)) {
          const t = tw.readTile(n.x, n.y);
          if (t && isWaterSource(t.tileId)) {
            v.waterReserve = MAX_WATER_RESERVE;
            return;
          }
        }
        // No water adjacent any more — drained or built over. Caller will
        // see reserve=0 and try again.
        break;
      }
      case JOB_KIND_WATER_CROP: {
        if (v.waterReserve <= 0) return;
        // Source IS the crop tile.
        if (tw.waterAt(job.source.x, job.source.y)) {
          v.waterReserve--;
        }
        break;
      }
      case JOB_KIND_HARVEST_CROP: {
        const result = tw.harvestAt(job.source.x, job.source.y);
        if (result.applied && result.produceItem != null && result.yield != null) {
          v.pickup(result.produceItem as Parameters<typeof v.pickup>[0], result.yield);
        }
        break;
      }
    }
  }

  private actAtTarget(
    v: Villager,
    _ctx: EntityTickContext,
    services: EntityServices,
    job: Job,
  ): void {
    if (job.kind !== JOB_KIND_HARVEST_CROP) return; // only HARVEST has a separate target
    const crates = services.crates;
    const tw = services.tileWorld;
    if (!crates || !tw) return;
    // job.target is the standing tile; find the adjacent crate tile and
    // deposit there. If somebody dismantled the crate while we were
    // walking, we drop nothing and the carried items stay until next deposit.
    let cratePos: { x: number; y: number } | null = null;
    for (const n of fourNeighbours(job.target.x, job.target.y)) {
      const t = tw.readTile(n.x, n.y);
      if (t && t.tileId === CRATE_TILE_ID) {
        cratePos = n;
        break;
      }
    }
    if (!cratePos) return;
    for (const [item, count] of Array.from(v.carriedItems)) {
      const stored = crates.deposit(cratePos.x, cratePos.y, item, count);
      if (stored > 0) v.drop(item, stored);
    }
  }
}

// Helpers ----------------------------------------------------------------

function sameTile(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return a.x === b.x && a.y === b.y;
}

function fourNeighbours(x: number, y: number): Array<{ x: number; y: number }> {
  return [
    { x: x + 1, y },
    { x: x - 1, y },
    { x, y: y + 1 },
    { x, y: y - 1 },
  ];
}

function hasUnclaimedWaterJob(board: import("../jobs").JobBoard): boolean {
  for (const j of board.all()) {
    if (j.claimedBy === 0 && j.kind === JOB_KIND_WATER_CROP) return true;
  }
  return false;
}

function sourceStillValid(job: Job, services: EntityServices): boolean {
  const tw = services.tileWorld;
  if (!tw) return false;
  switch (job.kind) {
    case JOB_KIND_HAUL_WATER: {
      // Source is a *standing* tile next to water. Walkability is enough —
      // the settler will re-discover water on the act step.
      const t = tw.readTile(job.source.x, job.source.y);
      return t !== null;
    }
    case JOB_KIND_WATER_CROP: {
      const t = tw.readTile(job.source.x, job.source.y);
      if (!t) return false;
      const crop = cropForTile(t.tileId);
      if (!crop) return false;
      if (t.state === CROP_STATE_WILTED) return false;
      // Already grown? Skip — emitter will pick it up as HARVEST instead.
      if (t.state >= CROP_STAGE_HARVESTABLE) return false;
      return true;
    }
    case JOB_KIND_HARVEST_CROP: {
      const t = tw.readTile(job.source.x, job.source.y);
      if (!t) return false;
      const crop = cropForTile(t.tileId);
      if (!crop) return false;
      return t.state >= CROP_STAGE_HARVESTABLE;
    }
  }
}
