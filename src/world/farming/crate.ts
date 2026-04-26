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
import { CHUNK_SIZE, type ChunkRecord, tileIndex } from "../chunk";
import { isEntityWalkable } from "../walkability";
import {
  type ContainerDef,
  containerForTile,
  CRATE_TILE_ID as REGISTRY_CRATE_TILE_ID,
} from "./container_registry";

// Re-exported from container_registry to keep existing imports working.
// New code should import from container_registry directly.
export const CRATE_TILE_ID = REGISTRY_CRATE_TILE_ID;

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

  // Find the closest container that will accept `itemId`, has spare
  // capacity, and exposes a walkable standing tile. Used by HARVEST jobs
  // to route produce — passing the produce item id lets the dispenser
  // (which only accepts seeds) reject naturally without callers needing
  // to know which container types exist.
  nearestContainerForDeposit(
    chunks: { allChunkRecords(): IterableIterator<[string, ChunkRecord]> },
    fromX: number,
    fromY: number,
    itemId: ItemId,
  ): {
    tileId: number;
    container: { x: number; y: number };
    standing: { x: number; y: number };
  } | null {
    return this.scanContainers(chunks, fromX, fromY, (tileId, def, wx, wy) => {
      if (!def.acceptsItem(itemId)) return false;
      return this.totalAt(wx, wy) < CRATE_CAPACITY;
    });
  }

  // Find the closest container that holds at least one item matching the
  // predicate. Used by HAUL_SEED to find a dispenser (or crate) with seed
  // stock. The predicate runs against item ids; the returned hit tells
  // the caller which exact item kind is available so they can pick it up.
  nearestContainerWithStock(
    chunks: { allChunkRecords(): IterableIterator<[string, ChunkRecord]> },
    fromX: number,
    fromY: number,
    itemMatches: (id: ItemId) => boolean,
  ): {
    tileId: number;
    container: { x: number; y: number };
    standing: { x: number; y: number };
    itemId: ItemId;
    count: number;
  } | null {
    let best: {
      tileId: number;
      container: { x: number; y: number };
      standing: { x: number; y: number };
      itemId: ItemId;
      count: number;
    } | null = null;
    const bestDist = Number.POSITIVE_INFINITY;

    const hit = this.scanContainers(chunks, fromX, fromY, (_tileId, _def, wx, wy) => {
      const inner = this.contents.get(tileKeyOf(wx, wy));
      if (!inner) return false;
      for (const id of inner.keys()) {
        if (itemMatches(id)) return true;
      }
      return false;
    });

    if (!hit) return null;
    // Pick a stable item kind from the matching container — first key in
    // insertion order. Keeps replays deterministic since Map preserves
    // insertion order.
    const inner = this.contents.get(tileKeyOf(hit.container.x, hit.container.y));
    if (!inner) return null;
    for (const [id, count] of inner) {
      if (itemMatches(id)) {
        best = { ...hit, itemId: id, count };
        break;
      }
    }
    void bestDist;
    return best;
  }

  // Shared scan: walk every loaded chunk for tiles that pass
  // isContainerTile, run `accept(tileId, def, wx, wy)`, return the
  // closest accepted tile + a walkable standing neighbour. Encapsulates
  // the chunk-snapshot + neighbour-walk dance the deposit and stock
  // finders both need.
  private scanContainers(
    chunks: { allChunkRecords(): IterableIterator<[string, ChunkRecord]> },
    fromX: number,
    fromY: number,
    accept: (tileId: number, def: ContainerDef, wx: number, wy: number) => boolean,
  ): {
    tileId: number;
    container: { x: number; y: number };
    standing: { x: number; y: number };
  } | null {
    const snap = new Map<string, ChunkRecord>();
    for (const [key, rec] of chunks.allChunkRecords()) snap.set(key, rec);
    const tileIdAt = (wx: number, wy: number): number | null => {
      const cx = Math.floor(wx / CHUNK_SIZE);
      const cy = Math.floor(wy / CHUNK_SIZE);
      const rec = snap.get(`${cx | 0},${cy | 0}`);
      if (!rec) return null;
      const lx = wx - cx * CHUNK_SIZE;
      const ly = wy - cy * CHUNK_SIZE;
      return rec.data.tileId[ly * CHUNK_SIZE + lx] ?? 0;
    };

    let best: {
      tileId: number;
      container: { x: number; y: number };
      standing: { x: number; y: number };
    } | null = null;
    let bestDist = Number.POSITIVE_INFINITY;

    for (const [key, record] of snap) {
      const [cx, cy] = parseTileKey(key);
      const baseX = cx * CHUNK_SIZE;
      const baseY = cy * CHUNK_SIZE;
      for (let ly = 0; ly < CHUNK_SIZE; ly++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const tid = record.data.tileId[tileIndex(lx, ly)] ?? 0;
          const def = containerForTile(tid);
          if (!def) continue;
          const wx = baseX + lx;
          const wy = baseY + ly;
          if (!accept(tid, def, wx, wy)) continue;
          const candidates = [
            { x: wx + 1, y: wy },
            { x: wx - 1, y: wy },
            { x: wx, y: wy + 1 },
            { x: wx, y: wy - 1 },
          ];
          for (const c of candidates) {
            const tile = tileIdAt(c.x, c.y);
            if (tile === null) continue;
            if (!isEntityWalkable(tile)) continue;
            const dist = Math.abs(c.x - fromX) + Math.abs(c.y - fromY);
            if (dist < bestDist) {
              bestDist = dist;
              best = { tileId: tid, container: { x: wx, y: wy }, standing: c };
            }
          }
        }
      }
    }
    return best;
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
