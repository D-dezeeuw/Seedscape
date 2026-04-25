// Player backpack. Flat item-id → count map, no slots, no stacks. Subscribers
// (UI panels) are notified on every change so they can re-render.
//
// Phase 3 has a single global inventory; Phase 4+ may grow chests, NPC
// inventories, and stack limits. Adding those should not require touching
// callers — extend this class, don't fork.

import type { ItemId } from "./items";

export type InventoryListener = (id: ItemId, newCount: number) => void;

export class Inventory {
  private readonly counts = new Map<ItemId, number>();
  private readonly listeners = new Set<InventoryListener>();

  count(id: ItemId): number {
    return this.counts.get(id) ?? 0;
  }

  // Add `n` items (positive). Returns the new count. n=0 is a no-op.
  add(id: ItemId, n: number): number {
    if (n < 0) throw new Error(`Inventory.add expects n >= 0, got ${n}`);
    if (n === 0) return this.count(id);
    const next = this.count(id) + n;
    this.counts.set(id, next);
    this.fire(id, next);
    return next;
  }

  // Remove `n` items if available. Returns true on success, false if there
  // weren't enough — the inventory is left unchanged on failure so callers
  // can use this as a precondition check.
  remove(id: ItemId, n: number): boolean {
    if (n < 0) throw new Error(`Inventory.remove expects n >= 0, got ${n}`);
    const current = this.count(id);
    if (current < n) return false;
    const next = current - n;
    if (next === 0) this.counts.delete(id);
    else this.counts.set(id, next);
    this.fire(id, next);
    return true;
  }

  has(id: ItemId, n = 1): boolean {
    return this.count(id) >= n;
  }

  // Snapshot for save serialization. Plain object so it round-trips through
  // JSON / structured-clone unchanged.
  toJSON(): Record<number, number> {
    const out: Record<number, number> = {};
    for (const [id, count] of this.counts) out[id] = count;
    return out;
  }

  // Replace the entire inventory contents from a snapshot. Fires one event
  // per resulting key so all subscribers re-render once.
  loadFromJSON(snapshot: Record<number, number>): void {
    const previousKeys = new Set(this.counts.keys());
    this.counts.clear();
    for (const [idStr, count] of Object.entries(snapshot)) {
      const id = Number(idStr) as ItemId;
      if (count > 0) this.counts.set(id, count);
    }
    // Notify for every key that changed (including those that went to 0).
    for (const id of previousKeys) if (!this.counts.has(id)) this.fire(id, 0);
    for (const [id, count] of this.counts) this.fire(id, count);
  }

  subscribe(listener: InventoryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  *entries(): IterableIterator<[ItemId, number]> {
    yield* this.counts.entries();
  }

  private fire(id: ItemId, newCount: number): void {
    for (const listener of this.listeners) listener(id, newCount);
  }
}
