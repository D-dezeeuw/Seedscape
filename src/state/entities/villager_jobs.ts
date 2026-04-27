// Settler job state machine. Owns one Villager's autonomy.
//
// Tasks (Phase 7.5+) are a stack: every active piece of work — a job
// claimed from the board, or an injected sub-task like "deposit my
// inventory before doing anything else" — pushes a Task. The TOP of
// the stack is what the settler is currently doing; popping returns
// to the suspended caller.
//
// Today only two kinds of tasks exist: `job` (a claim from JobBoard,
// dispatch by job.kind) and `deposit` (drop carried items at a crate
// before claiming a new job). The architecture allows future tasks
// like `eat` or `sleep` to slot in without changing the state machine.
//
// The path state machine (idle → requesting_path → walking → acting →
// idle) drives the *active* task — once it pops, the next tick starts
// the next task at idle. Single-task LIFO, no concurrency. Path
// requests are async; nonces let stale replies be discarded.
//
// The controller is intentionally keyed off the Villager — it does not
// reach into other entities or globals. Tests construct a Villager + a
// fake services object and call tick() in a loop.

import type { BuildingBufferStore } from "../../world/farming/building_buffer";
import {
  buildingInputCap,
  buildingOutputCap,
} from "../../world/farming/building_buffer_tick";
import { buildingForTile } from "../../world/farming/building_registry";
import { containerForTile, isSeedItem } from "../../world/farming/container_registry";
import { CRATE_TILE_ID } from "../../world/farming/crate";
import {
  CROP_STAGE_HARVESTABLE,
  CROP_STATE_WILTED,
  cropForTile,
} from "../../world/farming/crop_registry";
import { findNearestWaterSource } from "../../world/farming/water_finder";
import { isEntityWalkable, isWaterSource } from "../../world/walkability";
import { type ItemId, isItemDefaultSticky } from "../items";
import {
  JOB_KIND_FEED_BUILDING,
  JOB_KIND_HARVEST_CROP,
  JOB_KIND_HAUL_OUTPUT,
  JOB_KIND_HAUL_SEED,
  JOB_KIND_HAUL_WATER,
  JOB_KIND_PLANT_SEED,
  JOB_KIND_WATER_CROP,
  type Job,
  type JobKind,
} from "../jobs";

const TILE_FARMLAND_TILLED = 13;

import type { EntityServices, EntityTickContext } from "./entity";
import { MEMORY_EVENT_TYPES, recordMemory } from "./living_entity";
import { MAX_WATER_RESERVE, type Villager } from "./villager";

// Tunables. Adjusted to feel responsive without a setter.
const WALK_SPEED_TILES_PER_SEC = 4;
const ARRIVE_EPSILON = 0.1;
// Seconds the settler stays put on each act tile (harvest, water, deposit).
const ACT_DURATION_SEC = 0.6;
// Window across which the *first* claim attempt is spread, derived from a
// hash of the settler id. With 150 settlers spawned at once, this turns a
// 150-request spike on tick 0 into a smooth ~38/tick stream over the first
// few seconds. Anything in the 2–6s range works; 4s leaves the spawn
// animation visible without making settlers feel sluggish.
const FIRST_CLAIM_STAGGER_SEC = 4;
// After a failed claim (no matching job, or claim-and-release for stale
// HARVEST), back off briefly before re-asking. Without this, 150 idle
// settlers each scan the board every entity tick (~60Hz) — a hot loop
// over O(jobs) per settler. Even a small backoff drops that 60× and the
// jitter prevents them from re-syncing on a common cadence.
const FAIL_BACKOFF_MIN_SEC = 0.2;
const FAIL_BACKOFF_MAX_SEC = 0.5;
// Sentinel marking "no stagger applied yet" — initial value of
// nextClaimAttemptTime. Real timestamps are non-negative, so any negative
// number works; -Infinity makes the intent obvious in the debugger.
const STAGGER_UNSET = Number.NEGATIVE_INFINITY;
// First chance to break out of a stalled walk: at this point we ask the
// pathfinder for a fresh route from the current tile. World may have
// changed (a settler moved off the corridor, a new building opened a
// shortcut), so the new route can differ even though gridVersion didn't
// bump. We re-plan at most once per walk segment — see hasReplanned.
const REPLAN_THRESHOLD_SEC = 3.5;
// Last-resort: settler has been stuck for longer than the relax-then-
// ghost decay (entity_manager) plus a margin. Cancel the job and let a
// re-emit reschedule. Bumped from 5 to 6 so the relaxation has room to
// resolve without triggering a cancel cascade across a clumped crowd.
const STUCK_TIMEOUT_SEC = 6.0;

type Phase = "to_source" | "to_target";

// Discriminated task union. `job` resolves source/target/acts via the
// JobBoard entry; `deposit` carries its own coords because no board
// entry exists for it (it's an internal subtask).
type Task =
  | { kind: "job"; jobId: number }
  | {
      kind: "deposit";
      // Walkable tile adjacent to the crate. The settler stops here.
      standingTile: { x: number; y: number };
      // The crate tile itself — used for the deposit() call. Never walked onto.
      cratePos: { x: number; y: number };
    };

type ControllerState =
  | { kind: "idle" }
  | { kind: "requesting_path"; phase: Phase; requestNonce: number }
  | {
      kind: "walking";
      phase: Phase;
      // Waypoints stored flat: x0,y0,x1,y1,...
      waypoints: Int16Array;
      idx: number;
      // Last time we advanced a waypoint. If now - lastAdvance > timeout, give up.
      lastAdvanceTime: number;
    }
  | { kind: "acting"; phase: Phase; until: number }
  | { kind: "no_op" };

export class VillagerJobController {
  // Stack of pending tasks. Top (last element) is the active task; idle
  // means the stack is empty. Mid-task injection pushes a new task on
  // top; completion pops. LIFO — the *most recently injected* task
  // takes priority, which matches "drop everything and deposit before
  // doing anything else".
  private taskStack: Task[] = [];
  private state: ControllerState = { kind: "idle" };
  // Monotonic request id so async path replies that arrive after a
  // re-plan or task pop can be discarded.
  private nextNonce = 1;
  // Earliest time tickIdle is allowed to ask the board for work. Set by
  // the spawn-burst stagger (once, on first idle tick) and bumped after
  // every failed claim. Settlers wander while waiting.
  private nextClaimAttemptTime: number = STAGGER_UNSET;
  // True once we've burned our one stuck-induced re-plan slot for the
  // current task. Reset to false when the controller pops the task so
  // each fresh task gets a chance to dodge transient blockers.
  private hasReplanned = false;
  // Set by failTask (which runs from async path callbacks without a
  // ctx). Consumed at the next tickIdleClaim entry to bump
  // nextClaimAttemptTime — without this, a settler whose deposit
  // target is unreachable spins the pathfinder once per tick.
  private needsFailureBackoff = false;

  // Inspect helpers (debug UI, tests).
  // Returns the topmost JOB task's id — skips deposit subtasks. UI uses
  // this to show "Settler is on job #N"; tests use it to assert work
  // was claimed. Null when the stack is empty or contains only
  // injected sub-tasks (shouldn't happen with current task kinds).
  currentJobId(): number | null {
    for (let i = this.taskStack.length - 1; i >= 0; i--) {
      const t = this.taskStack[i];
      if (t && t.kind === "job") return t.jobId;
    }
    return null;
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
  // True when there's no active task at all. Distinct from
  // state.kind === "idle", which can also fire mid-stack between two
  // tasks during the brief tick where one popped and the next hasn't
  // started its path request yet.
  isIdle(): boolean {
    return this.taskStack.length === 0 && this.state.kind === "idle";
  }
  // Top task kind — UI hint ("currently depositing" vs "currently working").
  currentTaskKind(): "job" | "deposit" | null {
    return this.activeTask()?.kind ?? null;
  }

  // Top of the stack (active task) or null if empty.
  private activeTask(): Task | null {
    return this.taskStack[this.taskStack.length - 1] ?? null;
  }

  // Drop any active work back on the board (without removing job entries).
  // Called when the controlling entity is removed or the settler is being
  // possessed by the player and we want to suspend autonomy cleanly.
  // Releases every job claim on the stack — sub-tasks like deposit are
  // simply dropped because they own no external state.
  abandon(services: EntityServices | undefined): void {
    for (const t of this.taskStack) {
      if (t.kind === "job" && services?.jobs) services.jobs.release(t.jobId);
    }
    this.taskStack = [];
    this.state = { kind: "idle" };
    this.hasReplanned = false;
  }

  // Pop the top task and reset per-task state. Every transition out of
  // an active task must go through this helper — replacing it with an
  // inline `taskStack.pop()` would leak hasReplanned across tasks and
  // quietly disable replan-on-stuck for the resumed parent.
  private popTask(): void {
    this.taskStack.pop();
    this.state = { kind: "idle" };
    this.hasReplanned = false;
  }

  // Push a new task on top of the stack. The next tick starts it from
  // a clean idle state. Used both by the claim path (push job) and by
  // the auto-deposit injector (push deposit before claiming a job).
  private pushTask(task: Task): void {
    this.taskStack.push(task);
    this.state = { kind: "idle" };
    this.hasReplanned = false;
  }

  // Run one tick of the state machine. Returns true if the controller
  // handled the tick (settler is busy with a task); false if completely
  // idle and the caller should fall through to wander.
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

  // Idle dispatch: if there's a task on the stack, start it. Otherwise
  // try to pull a new job from the board (with stagger/backoff and the
  // overweight-deposit gate).
  private tickIdle(v: Villager, ctx: EntityTickContext, services: EntityServices): boolean {
    const top = this.activeTask();
    if (top) {
      // Resume / start the top task by walking to its source.
      return this.startActiveTask(v, ctx, services);
    }
    return this.tickIdleClaim(v, ctx, services);
  }

  // Stack is empty: try to claim a job (or inject a deposit if the
  // settler is overweight from a previous task).
  private tickIdleClaim(v: Villager, ctx: EntityTickContext, services: EntityServices): boolean {
    const board = services.jobs;
    if (!board) return false;

    // First-time stagger: derive a deterministic offset from the settler
    // id so a 150-spawn burst doesn't all hit the board on the same tick.
    // Returning false here means the villager wanders during the stagger
    // window — it's not standing still.
    if (this.nextClaimAttemptTime === STAGGER_UNSET) {
      this.nextClaimAttemptTime = ctx.time + idStagger(v.id, FIRST_CLAIM_STAGGER_SEC);
    }
    // Drain a pending failure-backoff (deposit injection failed, job
    // path failed, etc.) before honoring the stagger gate. Same jitter
    // as scheduleRetry so neighbour settlers don't sync on a cadence.
    if (this.needsFailureBackoff) {
      this.needsFailureBackoff = false;
      this.nextClaimAttemptTime = ctx.time + jitterBackoff(v.id, ctx.time);
    }
    if (ctx.time < this.nextClaimAttemptTime) return false;

    const fromX = v.worldTileX();
    const fromY = v.worldTileY();

    // Overweight gate: if the settler is hauling more than they should,
    // they go and dump *before* claiming new work. Skips if the only
    // things in the bag are sticky (seeds today; Job.holdItems in the
    // next commit will generalise this). The injection is one task at
    // a time — after deposit pops, the next idle tick will re-evaluate.
    if (
      v.isOverweight() &&
      hasDumpableItems(v, services) &&
      services.crates &&
      services.tileWorld
    ) {
      const target = pickDepositTarget(v, services, fromX, fromY);
      if (target) {
        this.pushTask({
          kind: "deposit",
          standingTile: target.standing,
          cratePos: target.crate,
        });
        this.startActiveTask(v, ctx, services);
        return true;
      }
      // No crate accepts our cargo — fall through to normal claim and
      // hope the next job (likely HARVEST → crate) opens room. If the
      // crate situation is genuinely permanent the player will see the
      // settler keep failing to deposit and intervene.
    }

    // Preference list: filter out kinds we can't fulfil right now. WATER
    // requires reserve > 0; PLANT_SEED requires a seed in inventory. The
    // claim picks the closest matching unclaimed job; subsequent
    // lazy-spawn blocks below cover the case where the prerequisite
    // (water reserve, carried seed) needs to be fetched first.
    const kinds: JobKind[] = [JOB_KIND_HARVEST_CROP, JOB_KIND_HAUL_WATER, JOB_KIND_HAUL_SEED];
    if (v.waterReserve > 0) kinds.push(JOB_KIND_WATER_CROP);
    if (carriedSeedId(v) !== null) kinds.push(JOB_KIND_PLANT_SEED);

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
          this.scheduleRetry(v, ctx);
          return false;
        }
      }
    }

    // Same lazy-spawn pattern for seeds: settler with no seed sees
    // unclaimed PLANT_SEED jobs → spawn a HAUL_SEED to a container that
    // holds seeds, claim it, do the trip, then on next idle we'll have
    // a seed and PLANT_SEED becomes claimable for real.
    if (!job && carriedSeedId(v) === null && hasUnclaimedPlantJob(board) && services.crates) {
      const stock = services.crates.nearestContainerWithStock(tileWorld, fromX, fromY, (id) =>
        isSeedItem(id),
      );
      if (stock) {
        const id = board.enqueue({
          kind: JOB_KIND_HAUL_SEED,
          source: { x: stock.standing.x, y: stock.standing.y },
          target: { x: stock.standing.x, y: stock.standing.y },
          priority: 5,
          payload: stock.itemId,
          // The seed we're about to fetch is reserved for the next
          // PLANT_SEED claim — don't let an auto-deposit detour drop it.
          // Defensive even though seeds are item-default-sticky: if a
          // future settler/inventory change drops the default, this
          // job-level claim still keeps the seed pinned.
          holdItems: [stock.itemId],
        });
        job = board.claim(v.id, { fromX, fromY });
        if (!job || job.id !== id) {
          if (job) board.release(job.id);
          this.scheduleRetry(v, ctx);
          return false;
        }
      }
    }

    if (!job) {
      this.scheduleRetry(v, ctx);
      return false;
    }

    // HARVEST_CROP: pick a destination container that accepts the produce
    // (crate yes, dispenser no — dispensers only take seeds). If nothing
    // qualifies, cancel the claim.
    if (job.kind === JOB_KIND_HARVEST_CROP) {
      const produce = job.payload as ItemId | 0;
      const hit =
        services.crates && services.tileWorld && produce !== 0
          ? services.crates.nearestContainerForDeposit(
              services.tileWorld,
              job.source.x,
              job.source.y,
              produce as ItemId,
            )
          : null;
      if (!hit) {
        board.release(job.id);
        this.scheduleRetry(v, ctx);
        return false;
      }
      job.target = hit.standing;
    }

    // PLANT_SEED claim: stamp the carried seed id into payload so
    // actAtSource knows what to plant. We already filtered out
    // PLANT_SEED above unless we're carrying a seed, so the lookup
    // should always succeed; the explicit guard is here for the
    // race where a sibling settler dropped our last seed mid-claim.
    if (job.kind === JOB_KIND_PLANT_SEED) {
      const seedId = carriedSeedId(v);
      if (seedId === null) {
        board.release(job.id);
        this.scheduleRetry(v, ctx);
        return false;
      }
      job.payload = seedId;
      // The seed travels with the settler to the tilled tile; mark it
      // as held so any mid-claim auto-deposit (none today, but the
      // hook is here for future mid-task injection) keeps the seed.
      job.holdItems = [seedId];
    }

    // Verify the source tile still matches what was emitted. Player
    // actions or sim ticks could have changed it (harvested the crop,
    // built over the water tile). Re-emit will pick it up next scan.
    if (!sourceStillValid(job, services)) {
      board.cancel(job.id, "stale source");
      this.scheduleRetry(v, ctx);
      return false;
    }

    this.pushTask({ kind: "job", jobId: job.id });
    this.startActiveTask(v, ctx, services);
    return true;
  }

  // Begin executing whatever task is on top of the stack. Resolves the
  // task's source coords and kicks off the path request. Returns true
  // (we handled the tick) unless the task can't be resolved, in which
  // case we pop and try again next tick.
  private startActiveTask(v: Villager, ctx: EntityTickContext, services: EntityServices): boolean {
    const task = this.activeTask();
    if (!task) return false;
    const src = taskSource(task, services);
    if (!src) {
      // Job vanished between push and start, or deposit target gone —
      // drop the task; the next idle tick will try claiming again.
      if (task.kind === "job" && services.jobs) services.jobs.cancel(task.jobId, "vanished");
      this.popTask();
      return true;
    }
    this.requestPath(v, ctx, services, "to_source", src);
    return true;
  }

  // After a failed claim, defer the next attempt by a jittered backoff so
  // 150 idle settlers don't all rescan the board on the same tick. Jitter
  // is hashed off (id, time) so neighbours don't sync on a common cadence.
  private scheduleRetry(v: Villager, ctx: EntityTickContext): void {
    this.nextClaimAttemptTime = ctx.time + jitterBackoff(v.id, ctx.time);
  }

  // Generic path request — works for any task because the source/target
  // is computed externally and passed in.
  private requestPath(
    v: Villager,
    _ctx: EntityTickContext,
    services: EntityServices,
    phase: Phase,
    goal: { x: number; y: number },
  ): void {
    const pathfinding = services.pathfinding;
    if (!pathfinding) return;
    const nonce = this.nextNonce++;
    this.state = {
      kind: "requesting_path",
      phase,
      requestNonce: nonce,
    };
    pathfinding
      .requestPath({ x: v.worldTileX(), y: v.worldTileY() }, { x: goal.x, y: goal.y })
      .then((reply) => this.onPathReply(nonce, phase, reply.waypoints, services))
      .catch(() => this.onPathFailed(nonce, services));
  }

  private onPathReply(
    nonce: number,
    phase: Phase,
    waypoints: Int16Array,
    services: EntityServices,
  ): void {
    if (this.state.kind !== "requesting_path") return;
    if (this.state.requestNonce !== nonce) return; // stale; we re-planned
    if (waypoints.length < 2) {
      // Path not found — fail the task. For job tasks, cancel the job;
      // for deposit, just drop the subtask (the parent job remains).
      this.failTask(services, "path not found");
      return;
    }
    this.state = {
      kind: "walking",
      phase,
      waypoints,
      // Skip waypoints[0] — that's the start tile we're already on.
      idx: 2,
      lastAdvanceTime: Number.NEGATIVE_INFINITY,
    };
    // Initialize lastAdvanceTime on the next walking tick so we don't
    // accidentally report "stuck" before the first frame ran. We can't
    // know ctx.time here without threading it through; -Infinity makes
    // the first walking tick set it and start the clock cleanly.
  }

  private onPathFailed(nonce: number, services: EntityServices): void {
    if (this.state.kind !== "requesting_path") return;
    if (this.state.requestNonce !== nonce) return;
    this.failTask(services, "path request rejected");
  }

  // Drop the active task. Cancels its job claim if it's a job task.
  // Sets needsFailureBackoff so the next tickIdleClaim throttles the
  // re-attempt — failures can fire from async callbacks, so we can't
  // call scheduleRetry directly (no ctx).
  private failTask(services: EntityServices, reason: string): void {
    const task = this.activeTask();
    if (task && task.kind === "job" && services.jobs) {
      services.jobs.cancel(task.jobId, reason);
    }
    this.popTask();
    this.needsFailureBackoff = true;
  }

  private tickWalking(v: Villager, ctx: EntityTickContext, services: EntityServices): boolean {
    if (this.state.kind !== "walking") return true;
    // First-tick init for the stuck timer (set by onPathReply to
    // -Infinity so we don't measure stuck-ness before walking begins).
    if (this.state.lastAdvanceTime === Number.NEGATIVE_INFINITY) {
      this.state.lastAdvanceTime = ctx.time;
    }
    const wp = this.state.waypoints;
    if (this.state.idx >= wp.length) {
      // Reached end of waypoints — should have transitioned out already.
      return this.advanceToActing(v, ctx, services);
    }
    const tx = (wp[this.state.idx] as number) + 0.5;
    const ty = (wp[this.state.idx + 1] as number) + 0.5;
    const remaining = v.moveToward(tx, ty, WALK_SPEED_TILES_PER_SEC, ctx.dt, ctx.isWalkable);
    if (remaining < ARRIVE_EPSILON) {
      // Forward progress: clear stuck timer and let the separation pass
      // restore full collision radius next tick.
      v.stuckSince = Number.NEGATIVE_INFINITY;
      this.state.idx += 2;
      this.state.lastAdvanceTime = ctx.time;
      if (this.state.idx >= wp.length) {
        return this.advanceToActing(v, ctx, services);
      }
      return true;
    }

    // Didn't advance this tick. Mark the entity as stuck (idempotent —
    // only the first call sets the timer, subsequent ones are no-ops
    // until we advance) so entity_manager.resolveSeparation can decay
    // its radius.
    if (v.stuckSince === Number.NEGATIVE_INFINITY) v.stuckSince = ctx.time;

    const stuckFor = ctx.time - this.state.lastAdvanceTime;
    if (stuckFor > STUCK_TIMEOUT_SEC) {
      // Last resort: relaxation didn't break the deadlock either.
      // Cancel; re-emit will reschedule the job from a clean slate.
      this.failTask(services, "stuck");
      v.stuckSince = Number.NEGATIVE_INFINITY;
      return true;
    }
    if (!this.hasReplanned && stuckFor > REPLAN_THRESHOLD_SEC) {
      // First chance: ask for a fresh path from the current tile. The
      // hasReplanned flag prevents a stuck settler from spamming the
      // worker — it's reset only when the controller pops the task.
      const phase = this.state.phase;
      const task = this.activeTask();
      if (task) {
        const goal =
          phase === "to_source" ? taskSource(task, services) : taskTarget(task, services);
        if (goal) {
          this.hasReplanned = true;
          this.requestPath(v, ctx, services, phase, goal);
        }
      }
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
      phase: this.state.phase,
      until: ctx.time + ACT_DURATION_SEC,
    };
    return true;
  }

  private tickActing(v: Villager, ctx: EntityTickContext, services: EntityServices): boolean {
    if (this.state.kind !== "acting") return true;
    if (ctx.time < this.state.until) return true;

    const task = this.activeTask();
    if (!task) {
      // Stack went empty under us — shouldn't happen, but recover.
      this.popTask();
      return true;
    }

    const board = services.jobs;
    if (!board) return true;

    // For job tasks, double-check the board entry hasn't been cancelled
    // (e.g., crash recovery); deposit tasks live entirely in-controller.
    if (task.kind === "job") {
      const job = board.get(task.jobId);
      if (!job) {
        this.popTask();
        return true;
      }
    }

    if (this.state.phase === "to_source") {
      this.actAtSource(task, v, ctx, services);
      const target = taskTarget(task, services);
      const source = taskSource(task, services);
      // If the task has no separate target (or it equals source), it's done.
      if (!target || (source && sameTile(source, target))) {
        this.completeTask(task, services);
        return true;
      }
      this.requestPath(v, ctx, services, "to_target", target);
      return true;
    }

    // phase === "to_target"
    this.actAtTarget(task, v, ctx, services);
    this.completeTask(task, services);
    return true;
  }

  // Mark the active task as successfully done: complete its board entry
  // (if any) and pop. Differs from failTask in that the job is
  // *consumed* not *cancelled* — telemetry/UI can distinguish later.
  private completeTask(task: Task, services: EntityServices): void {
    if (task.kind === "job" && services.jobs) services.jobs.complete(task.jobId);
    this.popTask();
  }

  // Source-act dispatch — runs the action at the source tile of the
  // active task. Safe to call on any task kind; job tasks dispatch by
  // job.kind, deposit tasks have no source action (the deposit happens
  // at the target/standing tile).
  private actAtSource(
    task: Task,
    v: Villager,
    ctx: EntityTickContext,
    services: EntityServices,
  ): void {
    if (task.kind === "deposit") {
      // Deposit tasks have source === standingTile. The deposit itself
      // happens here (one-phase task); actAtTarget is a no-op.
      this.depositAll(task, v, ctx, services);
      return;
    }
    const job = services.jobs?.get(task.jobId);
    if (!job) return;
    this.actAtSourceForJob(job, v, ctx, services);
  }

  // Target-act dispatch. Only HARVEST has a target action today; other
  // job kinds and deposit tasks return cleanly.
  private actAtTarget(
    task: Task,
    v: Villager,
    ctx: EntityTickContext,
    services: EntityServices,
  ): void {
    if (task.kind !== "job") return;
    const job = services.jobs?.get(task.jobId);
    if (!job) return;
    if (job.kind !== JOB_KIND_HARVEST_CROP) return;
    this.actAtTargetForHarvest(job, v, ctx, services);
  }

  private actAtSourceForJob(
    job: Job,
    v: Villager,
    ctx: EntityTickContext,
    services: EntityServices,
  ): void {
    const tw = services.tileWorld;
    if (!tw) return;
    // Sim tick is the canonical "when did this happen" stamp for memory
    // entries. Falls back to ctx.time floored when the test harness
    // doesn't pass simTick.
    const memTick = ctx.simTick ?? Math.floor(ctx.time);
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
            recordMemory(v, {
              type: MEMORY_EVENT_TYPES.HAULED_WATER,
              tick: memTick,
              tileX: n.x,
              tileY: n.y,
            });
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
          // subjectId carries the crop's produce item — looked up via
          // the tile so the memory shows "Watered wheat" not just "tile".
          const t = tw.readTile(job.source.x, job.source.y);
          const crop = t ? cropForTile(t.tileId) : null;
          recordMemory(v, {
            type: MEMORY_EVENT_TYPES.WATERED,
            tick: memTick,
            subjectId: crop?.produceItem ?? 0,
            tileX: job.source.x,
            tileY: job.source.y,
          });
        }
        break;
      }
      case JOB_KIND_HARVEST_CROP: {
        const result = tw.harvestAt(job.source.x, job.source.y);
        if (result.applied && result.produceItem != null && result.yield != null) {
          v.pickup(result.produceItem as Parameters<typeof v.pickup>[0], result.yield);
          recordMemory(v, {
            type: MEMORY_EVENT_TYPES.HARVESTED,
            tick: memTick,
            subjectId: result.produceItem,
            tileX: job.source.x,
            tileY: job.source.y,
          });
        }
        break;
      }
      case JOB_KIND_HAUL_SEED: {
        // Settler stands next to a container; withdraw the seed kind
        // recorded on the job. If the container ran dry mid-flight (e.g.
        // another settler beat us to it), the act becomes a no-op and
        // the next idle tick will spawn a fresh HAUL_SEED.
        const seedId = job.payload as ItemId | 0;
        if (seedId === 0 || !services.crates) break;
        for (const n of fourNeighbours(job.source.x, job.source.y)) {
          const t = tw.readTile(n.x, n.y);
          if (!t) continue;
          if (!containerForTile(t.tileId)) continue;
          const taken = services.crates.withdraw(n.x, n.y, seedId as ItemId, 1);
          if (taken > 0) {
            v.pickup(seedId as ItemId, taken);
            recordMemory(v, {
              type: MEMORY_EVENT_TYPES.HAULED_SEED,
              tick: memTick,
              subjectId: seedId,
              tileX: n.x,
              tileY: n.y,
            });
          }
          break;
        }
        break;
      }
      case JOB_KIND_PLANT_SEED: {
        // Source == target == empty tilled tile. Drop one seed and call
        // the tile action; if the tile got planted by someone else mid-
        // flight the action returns false and the seed stays dropped on
        // the floor (well, in carriedItems → waste). We re-read the tile
        // first to avoid that case.
        const seedId = job.payload as ItemId | 0;
        if (seedId === 0) break;
        const t = tw.readTile(job.source.x, job.source.y);
        if (!t || t.tileId !== TILE_FARMLAND_TILLED || t.state !== 0) break;
        const dropped = v.drop(seedId as ItemId, 1);
        if (dropped === 0) break;
        const planted = tw.plantSeedAt(job.source.x, job.source.y, seedId as ItemId);
        if (!planted) {
          // Refund the seed if the tile somehow rejected the plant.
          v.pickup(seedId as ItemId, dropped);
        } else {
          recordMemory(v, {
            type: MEMORY_EVENT_TYPES.PLANTED,
            tick: memTick,
            subjectId: seedId,
            tileX: job.source.x,
            tileY: job.source.y,
          });
        }
        break;
      }
    }
  }

  private actAtTargetForHarvest(
    job: Job,
    v: Villager,
    ctx: EntityTickContext,
    services: EntityServices,
  ): void {
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
    const memTick = ctx.simTick ?? Math.floor(ctx.time);
    let totalStored = 0;
    let lastItem: ItemId | 0 = 0;
    for (const [item, count] of Array.from(v.carriedItems)) {
      const stored = crates.deposit(cratePos.x, cratePos.y, item, count);
      if (stored > 0) {
        v.drop(item, stored);
        totalStored += stored;
        lastItem = item;
      }
    }
    if (totalStored > 0) {
      // One DEPOSITED entry per delivery — even if multiple item types
      // got stored. subjectId carries the last (or only) item, which is
      // typically the produce kind being routed; the tile coords point
      // at the crate itself so the memory reads as "stored wheat at (8, 8)".
      recordMemory(v, {
        type: MEMORY_EVENT_TYPES.DEPOSITED,
        tick: memTick,
        subjectId: lastItem as number,
        tileX: cratePos.x,
        tileY: cratePos.y,
      });
    }
  }

  // Deposit task action: drop everything we're carrying at the crate.
  // Like actAtTargetForHarvest but reads coords from the task instead
  // of from a Job. Skips items the parent task wants to keep
  // (Job.holdItems will land in the next commit).
  private depositAll(
    task: {
      kind: "deposit";
      standingTile: { x: number; y: number };
      cratePos: { x: number; y: number };
    },
    v: Villager,
    ctx: EntityTickContext,
    services: EntityServices,
  ): void {
    const crates = services.crates;
    if (!crates) return;
    const memTick = ctx.simTick ?? Math.floor(ctx.time);
    let totalStored = 0;
    let lastItem: ItemId | 0 = 0;
    for (const [item, count] of Array.from(v.carriedItems)) {
      const stored = crates.deposit(task.cratePos.x, task.cratePos.y, item, count);
      if (stored > 0) {
        v.drop(item, stored);
        totalStored += stored;
        lastItem = item;
      }
    }
    if (totalStored > 0) {
      recordMemory(v, {
        type: MEMORY_EVENT_TYPES.DEPOSITED,
        tick: memTick,
        subjectId: lastItem as number,
        tileX: task.cratePos.x,
        tileY: task.cratePos.y,
      });
    }
  }
}

// ---- Task source/target resolution ------------------------------------

// Returns the world tile a settler must reach to begin acting on the
// active task. For job tasks, that's the job's source; for deposit
// tasks, the standingTile (a walkable tile adjacent to the crate).
function taskSource(task: Task, services: EntityServices): { x: number; y: number } | null {
  if (task.kind === "deposit") return task.standingTile;
  const job = services.jobs?.get(task.jobId);
  if (!job) return null;
  return job.source;
}

// Returns the world tile a settler must reach for the second leg of a
// task (e.g. the crate after harvesting). Returns the same as
// taskSource for single-phase tasks.
function taskTarget(task: Task, services: EntityServices): { x: number; y: number } | null {
  if (task.kind === "deposit") return task.standingTile;
  const job = services.jobs?.get(task.jobId);
  if (!job) return null;
  return job.target;
}

// ---- Helpers ----------------------------------------------------------

// Knuth multiplicative hash on a 32-bit integer. Cheap, well-distributed,
// no per-call allocation. Used for both id stagger and per-attempt jitter
// so neighbour settlers don't sync on the same cadence.
function hash32(x: number): number {
  return (Math.imul(x | 0, 2654435761) >>> 0) / 0x1_0000_0000;
}

// Initial-claim stagger: deterministic offset in [0, windowSec) keyed off
// the settler id. Same settler always gets the same stagger across replays
// — no Math.random() means save/load determinism is preserved.
function idStagger(id: number, windowSec: number): number {
  return hash32(id) * windowSec;
}

// Per-attempt backoff: time-bucketed so the same settler retrying on
// successive ticks hashes to different jitter, breaking up cohort sync
// (the case where several settlers became idle on the exact same tick).
function jitterBackoff(id: number, time: number): number {
  const bucket = (id ^ ((time * 1000) | 0)) >>> 0;
  return FAIL_BACKOFF_MIN_SEC + hash32(bucket) * (FAIL_BACKOFF_MAX_SEC - FAIL_BACKOFF_MIN_SEC);
}

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
    case JOB_KIND_PLANT_SEED: {
      // Tile must still be empty tilled farmland. If a player or another
      // settler planted in the meantime, cancel.
      const t = tw.readTile(job.source.x, job.source.y);
      if (!t) return false;
      return t.tileId === TILE_FARMLAND_TILLED && t.state === 0;
    }
    case JOB_KIND_HAUL_SEED: {
      // Standing tile next to a container — walkability is enough; the
      // settler re-derives the actual container at act time.
      const t = tw.readTile(job.source.x, job.source.y);
      return t !== null;
    }
    case JOB_KIND_FEED_BUILDING:
    case JOB_KIND_HAUL_OUTPUT: {
      // Source/target are emitted as the building tile and resolved at
      // claim time by the controller. Validity here = building tile
      // still exists with a known def (defensive: dismantled buildings
      // shouldn't be claimable for fresh feeds/hauls).
      const t = tw.readTile(job.source.x, job.source.y);
      if (!t) return false;
      const def = buildingForTile(t.tileId);
      return def !== null && !def.passive;
    }
  }
}

// Helpers for new job kinds.

function carriedSeedId(v: Villager): ItemId | null {
  for (const [item] of v.carriedItems) {
    if (isSeedItem(item)) return item;
  }
  return null;
}

// Compute the union of every sticky item kind for a settler at this
// moment. Sources:
//   - Item def's defaultSticky (e.g. seeds — tiny, always useful)
//   - holdItems on every job currently claimed by this settler
// The deposit gate consults this set: anything in it stays carried
// through the auto-deposit pass. Computed on demand because both
// inputs (which items the settler holds, which jobs are claimed)
// change per tick — caching invites stale exemptions.
function stickyItemsFor(v: Villager, services: EntityServices): Set<ItemId> {
  const out = new Set<ItemId>();
  for (const [item] of v.carriedItems) {
    if (isItemDefaultSticky(item)) out.add(item);
  }
  if (services.jobs) {
    for (const job of services.jobs.all()) {
      if (job.claimedBy !== v.id) continue;
      if (!job.holdItems) continue;
      for (const id of job.holdItems) out.add(id);
    }
  }
  return out;
}

// True if the settler is carrying at least one item that would be
// dumped by an auto-deposit (i.e. NOT sticky for this entity right now).
function hasDumpableItems(v: Villager, services: EntityServices): boolean {
  const sticky = stickyItemsFor(v, services);
  for (const [item, count] of v.carriedItems) {
    if (count <= 0) continue;
    if (!sticky.has(item)) return true;
  }
  return false;
}

// Find the closest crate that will accept at least one of the
// settler's dumpable items. Returns the crate tile + its standing
// tile, or null if no candidate fits. Uses the same nearest-container
// logic as HARVEST routing so behavior is consistent across job kinds.
function pickDepositTarget(
  v: Villager,
  services: EntityServices,
  fromX: number,
  fromY: number,
): { crate: { x: number; y: number }; standing: { x: number; y: number } } | null {
  const crates = services.crates;
  const tw = services.tileWorld;
  if (!crates || !tw) return null;
  const sticky = stickyItemsFor(v, services);
  // Try each dumpable item in turn (Map insertion order). The first
  // one that finds a willing crate wins — we don't need to deposit
  // *all* items in one trip, the next idle tick will inject another
  // deposit if the settler is still overweight.
  for (const [item, count] of v.carriedItems) {
    if (count <= 0) continue;
    if (sticky.has(item)) continue;
    const hit = crates.nearestContainerForDeposit(tw, fromX, fromY, item);
    if (hit) {
      return { crate: hit.container, standing: hit.standing };
    }
  }
  return null;
}

function hasUnclaimedPlantJob(board: import("../jobs").JobBoard): boolean {
  for (const j of board.all()) {
    if (j.claimedBy === 0 && j.kind === JOB_KIND_PLANT_SEED) return true;
  }
  return false;
}
