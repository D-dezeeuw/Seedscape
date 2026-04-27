// Tiny adapter so the container-transfer window can talk to both the
// player's Inventory (unlimited count, no weight) and a possessed
// Villager's carriedItems (weight + per-stack capped). Same DOM, same
// transfer flow; different storage shape.
//
// Both sides settle on the "return count actually moved" convention so
// callers can re-balance overflow (refund excess back to the source)
// without branching on which kind of inventory they're talking to.

import type { Villager } from "./entities/villager";
import type { Inventory } from "./inventory";
import type { ItemId } from "./items";

export interface InventoryLike {
  // Yield every item kind currently held with its count. Empty when
  // nothing is held; ordering is implementation-defined (callers sort
  // when they need stable display).
  entries(): IterableIterator<[ItemId, number]>;
  // Items of `id` currently held; 0 when none.
  count(id: ItemId): number;
  // Try to add `n` of `id`. Returns the count actually accepted —
  // player Inventory always accepts everything, the Villager clamps
  // by carry weight + per-stack cap (Phase 7.5).
  add(id: ItemId, n: number): number;
  // Try to remove `n` of `id`. Returns the count actually removed.
  // Both impls clamp by available stock so the caller doesn't have
  // to pre-check.
  remove(id: ItemId, n: number): number;
  // Optional change notification. Player Inventory wires this to its
  // listener set; the Villager doesn't expose one, so the container
  // window's polling timer covers settler-side changes.
  subscribe?(listener: () => void): () => void;
}

// Wraps the player's Inventory in the InventoryLike shape. Inventory's
// own surface uses (add: returns new count) / (remove: returns bool),
// neither of which match the convention — this adapter normalises.
export function asPlayerInventoryLike(inv: Inventory): InventoryLike {
  return {
    entries: () => inv.entries(),
    count: (id) => inv.count(id),
    add: (id, n) => {
      if (n <= 0) return 0;
      inv.add(id, n);
      return n;
    },
    remove: (id, n) => {
      if (n <= 0) return 0;
      const have = inv.count(id);
      const taken = Math.min(have, n);
      if (taken === 0) return 0;
      // Inventory.remove only succeeds for the exact count, so we
      // pass the clamped value rather than the requested amount.
      inv.remove(id, taken);
      return taken;
    },
    subscribe: (listener) => inv.subscribe(() => listener()),
  };
}

// Wraps a possessed Villager's carriedItems. pickup() and drop()
// already clamp + return the moved count, so the adapter is mostly
// a passthrough. No subscribe — carriedItems isn't observable; the
// container window's polling timer keeps it in sync.
export function asSettlerInventoryLike(v: Villager): InventoryLike {
  return {
    entries: () => v.carriedItems.entries(),
    count: (id) => v.carriedItems.get(id) ?? 0,
    add: (id, n) => v.pickup(id, n),
    remove: (id, n) => v.drop(id, n),
  };
}
