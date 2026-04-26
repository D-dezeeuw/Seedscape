// Owns the live entity pool. Backed by a Map today; the public surface
// (add/remove/getById/iterate/tick/pickAt) hides storage so we can swap
// to typed-array pools later without touching callers.
//
// Entity ids are allocated monotonically from `nextId`. Save/load can
// preload an `nextId` value via setNextIdMin so restored entities don't
// collide with new ones.

import type { Entity, EntityTickContext } from "./entity";

export type EntityListener = () => void;

export class EntityManager {
  private nextId = 1;
  private readonly entities = new Map<number, Entity>();
  private readonly listeners = new Set<EntityListener>();

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

  tick(ctx: EntityTickContext): void {
    for (const e of this.entities.values()) e.tick(ctx);
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
