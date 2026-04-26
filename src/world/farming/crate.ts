// Storage crates. A new tile id (220) that:
//   - blocks walking (sits inside the building range 200..299, so
//     isEntityWalkable already rejects it)
//   - has no sim cycle (buildingForTile() returns null → sim_pipeline skips it)
//   - holds items in a sparse main-thread store keyed by world-tile coords
//
// Sparse store: crates are rare relative to total tiles (a few per farm, not
// per chunk). A flat per-chunk array would waste 32×32 slots * 4 bytes for
// 99% empty cells — a Map keyed by "wx,wy" with per-tile contents fits the
// access pattern (deposit/withdraw on a known tile, list nearest by scan).

import type { ItemId } from "../../state/items";

export const CRATE_TILE_ID = 220;

// Sized to give settlers room to drop several harvest cycles before a player
// has to clean up — but small enough that a runaway emitter doesn't dump a
// galaxy of items into one tile.
export const CRATE_CAPACITY = 200;

const tileKeyOf = (x: number, y: number): string => `${x | 0},${y | 0}`;
const parseTileKey = (key: string): [number, number] => {
  const comma = key.indexOf(",");
  return [Number(key.slice(0, comma)), Number(key.slice(comma + 1))];
};

export interface CrateContentsSnapshot {
  // Flat map: { "x,y": { itemId: count } }. Stored as plain object so it
  // round-trips through structured clone unchanged.
  [tileKey: string]: { [itemId: number]: number };
}

export class CrateStore {
  // tileKey -> ItemId -> count
  private readonly contents = new Map<string, Map<ItemId, number>>();

  totalAt(x: number, y: number): number {
    const inner = this.contents.get(tileKeyOf(x, y));
    if (!inner) return 0;
    let sum = 0;
    for (const n of inner.values()) sum += n;
    return sum;
  }

  countAt(x: number, y: number, item: ItemId): number {
    return this.contents.get(tileKeyOf(x, y))?.get(item) ?? 0;
  }

  // Try to deposit `n` of `item` at (x,y). Returns the count actually stored
  // — clamped by remaining capacity. Caller adjusts the source by the
  // returned amount.
  deposit(x: number, y: number, item: ItemId, n: number): number {
    if (n <= 0) return 0;
    const key = tileKeyOf(x, y);
    let inner = this.contents.get(key);
    if (!inner) {
      inner = new Map();
      this.contents.set(key, inner);
    }
    let total = 0;
    for (const c of inner.values()) total += c;
    const room = Math.max(0, CRATE_CAPACITY - total);
    const stored = Math.min(n, room);
    if (stored === 0) return 0;
    inner.set(item, (inner.get(item) ?? 0) + stored);
    return stored;
  }

  // Try to withdraw `n` of `item` at (x,y). Returns the count actually
  // removed (clamped by available stock).
  withdraw(x: number, y: number, item: ItemId, n: number): number {
    if (n <= 0) return 0;
    const key = tileKeyOf(x, y);
    const inner = this.contents.get(key);
    if (!inner) return 0;
    const have = inner.get(item) ?? 0;
    const taken = Math.min(have, n);
    if (taken === 0) return 0;
    const remaining = have - taken;
    if (remaining === 0) inner.delete(item);
    else inner.set(item, remaining);
    if (inner.size === 0) this.contents.delete(key);
    return taken;
  }

  // Drop all entries for a tile. Called when a crate is dismantled so the
  // sparse map doesn't leak phantom contents.
  clearAt(x: number, y: number): void {
    this.contents.delete(tileKeyOf(x, y));
  }

  // Iterate every crate's coords. Used for save serialization and the
  // "nearest crate" scan; ordering follows insertion (Map iteration order).
  *crates(): IterableIterator<{ x: number; y: number; total: number }> {
    for (const [key, inner] of this.contents) {
      const [x, y] = parseTileKey(key);
      let total = 0;
      for (const c of inner.values()) total += c;
      yield { x, y, total };
    }
  }

  // Find the closest crate with available capacity for `item`, by Manhattan
  // distance from (fromX, fromY). Returns null if no crate exists. The
  // pathfinder still has to confirm reachability — this is a hint, not a
  // proof.
  nearestCrateWithRoom(fromX: number, fromY: number): { x: number; y: number } | null {
    let bestKey: string | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const [key, inner] of this.contents) {
      let total = 0;
      for (const c of inner.values()) total += c;
      if (total >= CRATE_CAPACITY) continue;
      const [x, y] = parseTileKey(key);
      const dist = Math.abs(x - fromX) + Math.abs(y - fromY);
      if (dist < bestDist) {
        bestDist = dist;
        bestKey = key;
      }
    }
    if (!bestKey) return null;
    const [x, y] = parseTileKey(bestKey);
    return { x, y };
  }

  toJSON(): CrateContentsSnapshot {
    const out: CrateContentsSnapshot = {};
    for (const [key, inner] of this.contents) {
      const dump: { [itemId: number]: number } = {};
      for (const [item, count] of inner) dump[item] = count;
      out[key] = dump;
    }
    return out;
  }

  loadFromJSON(snapshot: CrateContentsSnapshot): void {
    this.contents.clear();
    for (const [key, items] of Object.entries(snapshot)) {
      const inner = new Map<ItemId, number>();
      for (const [itemStr, count] of Object.entries(items)) {
        if (count > 0) inner.set(Number(itemStr) as ItemId, count);
      }
      if (inner.size > 0) this.contents.set(key, inner);
    }
  }
}
