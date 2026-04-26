// Per-tick restocking for auto-stocking containers (currently the seed
// dispenser). Walks every loaded chunk for tiles flagged `autoRestock`
// and tops them up from the player's inventory until each is at its
// per-item cap.
//
// Why per-item cap (not just total): seeds are diverse (wheat, carrot,
// corn) and a player with stocks of all three should see a balanced
// dispenser, not one that fills up on whichever seed iterated first.
// We grant each accepted item type up to PER_ITEM_RESTOCK_CAP slots in
// the dispenser; the total is implicitly capped by CRATE_CAPACITY.

import type { Inventory } from "../../state/inventory";
import type { ItemId } from "../../state/items";
import { CHUNK_SIZE, type ChunkRecord, tileIndex } from "../chunk";
import { containerForTile, listContainers } from "./container_registry";
import type { CrateStore } from "./crate";
import { CRATE_CAPACITY } from "./crate";

// Per-item restock cap inside one dispenser. 20 wheat + 20 carrot + 20
// corn = 60 of CRATE_CAPACITY=200, plenty of headroom for future seed
// types without nudging up against the total cap.
export const PER_ITEM_RESTOCK_CAP = 20;

export interface ChunkSource {
  allChunkRecords(): IterableIterator<[string, ChunkRecord]>;
}

// Run one restock pass. Returns the number of items moved from inventory
// into containers — useful for the test harness; production callers can
// ignore it. Skips early when no auto-restock containers exist (saves
// the chunk scan when the player hasn't placed any dispensers yet).
export function restockAutoContainers(
  chunks: ChunkSource,
  inventory: Inventory,
  crates: CrateStore,
): number {
  // Bail if the registry has no auto-restock kinds at all (defensive — if
  // a future container loses its autoRestock flag the cost is zero).
  const hasAuto = listContainers().some((c) => c.autoRestock);
  if (!hasAuto) return 0;

  let moved = 0;
  for (const [key, record] of chunks.allChunkRecords()) {
    const [cxStr, cyStr] = key.split(",");
    const cx = Number(cxStr);
    const cy = Number(cyStr);
    const baseX = cx * CHUNK_SIZE;
    const baseY = cy * CHUNK_SIZE;
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const tid = record.data.tileId[tileIndex(lx, ly)] ?? 0;
        const def = containerForTile(tid);
        if (!def || !def.autoRestock) continue;
        const wx = baseX + lx;
        const wy = baseY + ly;
        // Total cap on the container itself.
        const totalNow = crates.totalAt(wx, wy);
        if (totalNow >= CRATE_CAPACITY) continue;
        let totalRoom = CRATE_CAPACITY - totalNow;
        // Walk inventory items; transfer accepted ones up to per-item cap.
        for (const [item, count] of inventory.entries()) {
          if (totalRoom <= 0) break;
          if (!def.acceptsItem(item as ItemId)) continue;
          const have = crates.countAt(wx, wy, item as ItemId);
          const room = Math.min(PER_ITEM_RESTOCK_CAP - have, totalRoom);
          if (room <= 0) continue;
          const take = Math.min(count, room);
          if (take <= 0) continue;
          if (!inventory.remove(item as ItemId, take)) continue;
          const stored = crates.deposit(wx, wy, item as ItemId, take);
          // Should always equal `take` since we computed room from
          // capacity, but be defensive: if the deposit accepted less
          // than we removed, refund the difference.
          if (stored < take) inventory.add(item as ItemId, take - stored);
          moved += stored;
          totalRoom -= stored;
        }
      }
    }
  }
  return moved;
}
