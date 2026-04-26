// Job board — main-thread singleton consumed by autonomous settlers and
// produced by world-scan emitters.
//
// A "job" is a small record of intent: who needs what, at which tile, by
// when. Settlers don't search the world; they ask the board for work that
// matches their state, claim it, do it, and complete or cancel.
//
// Design notes:
//   - Single-claim mutex: claim() atomically marks the job and returns it,
//     or returns null if already taken. No double-bookings.
//   - Stale-job policy: if the world changes underneath a job (the source
//     crop got harvested by a player, the target tile became a building,
//     the crate filled up), the settler cancels and the next emitter scan
//     will re-emit if the underlying need is still real.
//   - No priority queue yet: claim() does a linear scan over unclaimed
//     jobs filtering by kind, picks the closest by Manhattan distance to
//     the settler. With <300 active jobs this is faster than maintaining
//     per-kind heaps and lets us keep the data structure flat.

import type { ItemId } from "./items";

export const JOB_KIND_HAUL_WATER = 1;
export const JOB_KIND_WATER_CROP = 2;
export const JOB_KIND_HARVEST_CROP = 3;
export type JobKind =
  | typeof JOB_KIND_HAUL_WATER
  | typeof JOB_KIND_WATER_CROP
  | typeof JOB_KIND_HARVEST_CROP;

export interface Job {
  id: number;
  kind: JobKind;
  // source.x/y is where the settler must reach first (water tile, ripe
  // crop). target.x/y is the delivery destination (thirsty crop, crate).
  // Some kinds (HAUL_WATER) keep source === target; the state machine
  // handles them uniformly.
  source: { x: number; y: number };
  target: { x: number; y: number };
  priority: number;
  // 0 = unclaimed, otherwise the entity id holding the claim.
  claimedBy: number;
  // Optional payload — for HARVEST_CROP this is the produce ItemId. Zero
  // means "not applicable".
  payload: ItemId | 0;
  // Frame/time the job was last advanced. Settlers stamp this so the board
  // can detect stuck jobs and force-cancel them.
  lastProgressTime: number;
}

export interface ClaimFilter {
  kinds?: ReadonlyArray<JobKind>;
  // Settler's current position so closest-job selection is meaningful.
  fromX: number;
  fromY: number;
}

export class JobBoard {
  private readonly jobs = new Map<number, Job>();
  private nextId = 1;

  // Total job count (claimed + unclaimed). Used by the emitter to bound
  // total queue depth and by the debug HUD.
  size(): number {
    return this.jobs.size;
  }

  unclaimedCount(): number {
    let n = 0;
    for (const j of this.jobs.values()) if (j.claimedBy === 0) n++;
    return n;
  }

  enqueue(spec: Omit<Job, "id" | "claimedBy" | "lastProgressTime">): number {
    const id = this.nextId++;
    this.jobs.set(id, { ...spec, id, claimedBy: 0, lastProgressTime: 0 });
    return id;
  }

  // Find the closest matching unclaimed job and atomically claim it.
  // Returns null if none match. Closest-by-Manhattan keeps settlers from
  // crisscrossing the farm.
  claim(entityId: number, filter: ClaimFilter): Job | null {
    let bestId = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    let bestPriority = -1;
    for (const job of this.jobs.values()) {
      if (job.claimedBy !== 0) continue;
      if (filter.kinds && !filter.kinds.includes(job.kind)) continue;
      const d = Math.abs(job.source.x - filter.fromX) + Math.abs(job.source.y - filter.fromY);
      // Higher priority strictly wins; same priority falls back to distance.
      if (
        job.priority > bestPriority ||
        (job.priority === bestPriority && d < bestDist)
      ) {
        bestId = job.id;
        bestDist = d;
        bestPriority = job.priority;
      }
    }
    if (bestId === 0) return null;
    const job = this.jobs.get(bestId);
    if (!job || job.claimedBy !== 0) return null; // race-safety; shouldn't fire
    job.claimedBy = entityId;
    return job;
  }

  // Look up a job (claimed or unclaimed). Settlers use this on every tick
  // of an in-progress job to detect cancel-from-elsewhere.
  get(jobId: number): Job | null {
    return this.jobs.get(jobId) ?? null;
  }

  // Mark progress so the stale-job sweeper knows the settler is alive.
  markProgress(jobId: number, time: number): void {
    const job = this.jobs.get(jobId);
    if (job) job.lastProgressTime = time;
  }

  // Drop a job from the board (success path). Idempotent.
  complete(jobId: number): void {
    this.jobs.delete(jobId);
  }

  // Drop a job (failure path). Same effect as complete; the distinction is
  // only meaningful for telemetry/logging the caller does.
  cancel(jobId: number, _reason: string): void {
    this.jobs.delete(jobId);
  }

  // Release a claim without removing the job. Used when a settler bails
  // mid-route (e.g., new building blocks the path) but the job itself is
  // still actionable — another settler may pick it up.
  release(jobId: number): void {
    const job = this.jobs.get(jobId);
    if (job) job.claimedBy = 0;
  }

  // Drop every claim held by an entity (e.g., on entity removal). Doesn't
  // delete the jobs — they go back to unclaimed.
  releaseAllByEntity(entityId: number): void {
    for (const job of this.jobs.values()) {
      if (job.claimedBy === entityId) job.claimedBy = 0;
    }
  }

  // Iterate every job. Used by emitters to dedupe and by the HUD.
  *all(): IterableIterator<Job> {
    yield* this.jobs.values();
  }

  // True iff a matching job already exists. Emitters call this before
  // enqueueing so periodic scans don't pile duplicates onto the same tile.
  hasJobAt(kind: JobKind, sourceX: number, sourceY: number): boolean {
    for (const job of this.jobs.values()) {
      if (job.kind !== kind) continue;
      if (job.source.x === sourceX && job.source.y === sourceY) return true;
    }
    return false;
  }

  clear(): void {
    this.jobs.clear();
    this.nextId = 1;
  }
}
