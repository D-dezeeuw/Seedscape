// Owns the live entity pool. Backed by a Map today; the public surface
// (add/remove/getById/iterate/tick/pickAt) hides storage so we can swap
// to typed-array pools later without touching callers.
//
// Entity ids are allocated monotonically from `nextId`. Save/load can
// preload an `nextId` value via setNextIdMin so restored entities don't
// collide with new ones.

import type { Entity, EntityTickContext } from "./entity";
import { LivingEntity } from "./living_entity";

export type EntityListener = () => void;

// Soft-collide radius (tiles). Two LivingEntity centers closer than this
// get pushed apart along the connecting line. Tuned so the placeholder
// disc (~0.85 tile diameter) doesn't visibly overlap.
const SEPARATION_RADIUS = 0.7;

export class EntityManager {
  private nextId = 1;
  private readonly entities = new Map<number, Entity>();
  private readonly listeners = new Set<EntityListener>();
  // Pooled list used to snapshot the entity set at the start of each tick.
  // Iterating Map.values() during ticks is fragile: a tick that adds or
  // removes entities (Phase 7's job system spawns / despawns drone units,
  // future death events) would mutate the live iterator and either re-tick
  // a fresh entity this same frame, skip a removed one mid-iteration, or
  // — worst case — read a removed entity. Snapshotting first decouples
  // this frame's tick set from the next. Array reused across frames so
  // there's no per-frame allocation in the steady state.
  private readonly tickSnapshot: Entity[] = [];

  add(entity: Entity): void {
    if (this.entities.has(entity.id)) {
      throw new Error(`EntityManager: duplicate id ${entity.id}`);
    }
    this.entities.set(entity.id, entity);
    if (entity.id >= this.nextId) this.nextId = entity.id + 1;
    this.fire();
  }

  remove(id: number): boolean {
    const removed = this.entities.delete(id);
    if (removed) this.fire();
    return removed;
  }

  getById(id: number): Entity | null {
    return this.entities.get(id) ?? null;
  }

  // Returns the closest entity within `radius` tiles of the given world
  // coords, or null. Used by the click picker and hover info — radius
  // 0.5 picks "the entity standing on this tile".
  pickAt(worldX: number, worldY: number, radius: number): Entity | null {
    let best: Entity | null = null;
    let bestDist = radius;
    for (const e of this.entities.values()) {
      const dx = e.worldX() - worldX;
      const dy = e.worldY() - worldY;
      const d = Math.hypot(dx, dy);
      if (d < bestDist) {
        best = e;
        bestDist = d;
      }
    }
    return best;
  }

  iterate(): IterableIterator<Entity> {
    return this.entities.values();
  }

  size(): number {
    return this.entities.size;
  }

  // skipId names an entity whose AI tick should NOT run this frame —
  // typically the possessed avatar (its movement is driven by player
  // input, not its own AI). Separation still applies so the possessed
  // entity participates in soft-collide pushes.
  //
  // Iterates over a snapshot of the entity set so a tick that mutates
  // entities (add/remove) doesn't observe its own changes — the new
  // entity gets ticked next frame, the removed entity isn't ticked
  // even if it was before the mutation point. Predictable, replayable.
  tick(ctx: EntityTickContext, skipId: number | null = null): void {
    const list = this.tickSnapshot;
    list.length = 0;
    for (const e of this.entities.values()) list.push(e);
    for (let i = 0; i < list.length; i++) {
      const e = list[i] as Entity;
      if (skipId !== null && e.id === skipId) continue;
      // Skip entities removed mid-tick — they're still in the snapshot
      // but no longer in the live map, so ticking them would mutate a
      // detached object.
      if (!this.entities.has(e.id)) continue;
      e.tick(ctx);
    }
    list.length = 0; // release references — entities held only briefly
    this.resolveSeparation(ctx);
  }

  // Quadratic O(n²) push-apart pass. Cheap with ≤16 entities; replace
  // with a spatial hash when entity count climbs. Pushes only happen if
  // the destination tile is walkable, so soft-collide can't shove a
  // villager into water.
  private resolveSeparation(ctx: EntityTickContext): void {
    const list: LivingEntity[] = [];
    for (const e of this.entities.values()) {
      if (e instanceof LivingEntity) list.push(e);
    }
    for (let i = 0; i < list.length; i++) {
      const a = list[i] as LivingEntity;
      if (!a.softCollide) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j] as LivingEntity;
        if (!b.softCollide) continue;
        const dx = a.worldX() - b.worldX();
        const dy = a.worldY() - b.worldY();
        const d = Math.hypot(dx, dy);
        if (d >= SEPARATION_RADIUS) continue;
        // Tiny offset for the perfectly-overlapping case so we still
        // have a direction to push along.
        const safe = d > 1e-4 ? d : 1e-4;
        const ux = dx / safe || 1; // fallback unit if d=0
        const uy = dy / safe || 0;
        const push = (SEPARATION_RADIUS - d) * 0.5;

        const ax = a.worldX() + ux * push;
        const ay = a.worldY() + uy * push;
        if (ctx.isWalkable(Math.floor(ax), Math.floor(ay))) a.setWorldPosition(ax, ay);

        const bx = b.worldX() - ux * push;
        const by = b.worldY() - uy * push;
        if (ctx.isWalkable(Math.floor(bx), Math.floor(by))) b.setWorldPosition(bx, by);
      }
    }
  }

  allocateId(): number {
    return this.nextId++;
  }

  // Used by save/load to ensure newly-allocated ids don't collide with
  // serialized ones on a load that happens before any add().
  setNextIdMin(min: number): void {
    if (min > this.nextId) this.nextId = min;
  }

  subscribe(cb: EntityListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private fire(): void {
    for (const cb of this.listeners) cb();
  }
}
