// NPC order book. Each NPC owns a slot list of pending orders. Orders refill
// on a fixed cadence (no dynamic supply/demand math in Phase 4 — see
// project_phase_deferred.md). Pricing comes from item base prices at a
// per-NPC margin.

import type { ItemId } from "./items";
import { getItemDef, ITEM_IDS } from "./items";

export interface NpcDef {
  id: string;
  displayName: string;
  // Items the NPC will request. Picked round-robin so each NPC has a
  // consistent persona ("Bram only buys flour and bread", "Tess buys raw
  // crops"). Phase 4.5 will replace this with biome- and demand-weighted
  // selection.
  buys: ReadonlyArray<ItemId>;
  // Multiplier applied on top of the item's basePrice when this NPC offers
  // for it. Lets us tune profitability per NPC without touching item data.
  priceMultiplier: number;
  // Min/max units per order — picked deterministically per slot to keep the
  // pacing predictable.
  minQuantity: number;
  maxQuantity: number;
}

export const NPC_DEFS: ReadonlyArray<NpcDef> = [
  {
    id: "tess",
    displayName: "Trader Tess",
    buys: [ITEM_IDS.WHEAT, ITEM_IDS.CARROT, ITEM_IDS.CORN],
    priceMultiplier: 1.0,
    minQuantity: 4,
    maxQuantity: 10,
  },
  {
    id: "bram",
    displayName: "Baker Bram",
    buys: [ITEM_IDS.FLOUR, ITEM_IDS.BREAD],
    priceMultiplier: 1.1,
    minQuantity: 2,
    maxQuantity: 6,
  },
];

export interface NpcOrder {
  npcId: string;
  itemId: ItemId;
  quantity: number;
  priceEach: number;
  // Wall-clock seconds since orders started, when this order was created.
  // Used to compute "age" without storing the absolute date.
  createdAtSec: number;
}

export type OrderListener = (orders: ReadonlyArray<NpcOrder>) => void;

const ORDERS_PER_NPC = 2;
const ORDER_REFRESH_INTERVAL_SEC = 60;

function priceFor(npc: NpcDef, itemId: ItemId): number {
  const base = getItemDef(itemId).basePrice;
  return Math.max(1, Math.round(base * npc.priceMultiplier));
}

// Tiny deterministic LCG used to pick quantities and item rotation. Same
// seed → same sequence; lets save/load reproduce the order book without
// storing the entire list (Phase 4 still saves the list for simplicity).
function lcg(seed: number): () => number {
  let s = seed | 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 16) & 0x7fff) / 0x8000;
  };
}

export class OrderBook {
  private orders: NpcOrder[] = [];
  private nextRefreshSec: number;
  private readonly listeners = new Set<OrderListener>();
  private rng = lcg(1);
  private rotationOffset: Record<string, number> = {};

  constructor(initialNowSec = 0) {
    this.nextRefreshSec = initialNowSec; // refresh immediately on first tick
  }

  // Drive the order book forward. Call from the main loop with a monotonic
  // seconds counter; the book refreshes when due.
  tick(nowSec: number): void {
    if (nowSec < this.nextRefreshSec) return;
    this.refresh(nowSec);
    this.nextRefreshSec = nowSec + ORDER_REFRESH_INTERVAL_SEC;
  }

  // Take an order off the book. Returns the order that was fulfilled (so
  // callers can credit coins / XP) or null if the index was stale.
  fulfill(index: number): NpcOrder | null {
    const order = this.orders[index];
    if (!order) return null;
    this.orders.splice(index, 1);
    this.fire();
    return order;
  }

  list(): ReadonlyArray<NpcOrder> {
    return this.orders;
  }

  subscribe(listener: OrderListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  toJSON(): { orders: NpcOrder[]; nextRefreshSec: number } {
    return { orders: [...this.orders], nextRefreshSec: this.nextRefreshSec };
  }

  loadFromJSON(snapshot: { orders: NpcOrder[]; nextRefreshSec: number }): void {
    this.orders = [...snapshot.orders];
    this.nextRefreshSec = snapshot.nextRefreshSec;
    this.fire();
  }

  private refresh(nowSec: number): void {
    this.orders = [];
    for (const npc of NPC_DEFS) {
      const offset = this.rotationOffset[npc.id] ?? 0;
      for (let slot = 0; slot < ORDERS_PER_NPC; slot++) {
        const itemIdx = (offset + slot) % npc.buys.length;
        const itemId = npc.buys[itemIdx] as ItemId;
        const span = npc.maxQuantity - npc.minQuantity;
        const quantity = npc.minQuantity + Math.floor(this.rng() * (span + 1));
        this.orders.push({
          npcId: npc.id,
          itemId,
          quantity,
          priceEach: priceFor(npc, itemId),
          createdAtSec: Math.floor(nowSec),
        });
      }
      this.rotationOffset[npc.id] = (offset + 1) % npc.buys.length;
    }
    this.fire();
  }

  private fire(): void {
    for (const listener of this.listeners) listener(this.orders);
  }
}
