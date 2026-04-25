// NPC orders panel — list of active buy orders with a Sell button per row.
// Selling deducts items from inventory and credits coins + XP.

import type { Inventory } from "../state/inventory";
import { getItemDef } from "../state/items";
import type { OrderBook } from "../state/orders";
import { NPC_DEFS } from "../state/orders";
import type { Player } from "../state/player";

const SELL_XP_PER_COIN = 1;

interface OrdersPanelDeps {
  parent: HTMLElement;
  orders: OrderBook;
  inventory: Inventory;
  player: Player;
}

const NPC_NAMES: Record<string, string> = Object.fromEntries(
  NPC_DEFS.map((n) => [n.id, n.displayName]),
);

export function createOrdersPanel(deps: OrdersPanelDeps): () => void {
  const panel = document.createElement("div");
  panel.className = "ss-panel ss-orders";
  panel.innerHTML = `<h3>Orders</h3><div data-field="rows"></div>`;
  deps.parent.appendChild(panel);
  const rows = panel.querySelector('[data-field="rows"]') as HTMLDivElement;

  const render = (): void => {
    const list = deps.orders.list();
    if (list.length === 0) {
      rows.innerHTML = `<div class="ss-empty">no orders right now</div>`;
      return;
    }
    rows.innerHTML = "";
    list.forEach((order, idx) => {
      const item = getItemDef(order.itemId);
      const have = deps.inventory.count(order.itemId);
      const canSell = have >= order.quantity;
      const total = order.priceEach * order.quantity;
      const row = document.createElement("div");
      row.className = "ss-order";
      row.innerHTML = `
        <div class="ss-order-head">
          <span>${NPC_NAMES[order.npcId] ?? order.npcId}</span>
          <span class="ss-coin">${total}c</span>
        </div>
        <div class="ss-order-body">
          <span>${order.quantity}× ${item.displayName} <span class="ss-dim">(${have} have)</span></span>
        </div>
      `;
      const button = document.createElement("button");
      button.className = "ss-btn ss-btn-sell";
      button.textContent = "Sell";
      button.disabled = !canSell;
      button.addEventListener("click", () => {
        const ok = deps.inventory.remove(order.itemId, order.quantity);
        if (!ok) return;
        const fulfilled = deps.orders.fulfill(idx);
        if (!fulfilled) {
          // The order vanished between render and click. Refund the items.
          deps.inventory.add(order.itemId, order.quantity);
          return;
        }
        deps.player.addCoins(fulfilled.priceEach * fulfilled.quantity);
        deps.player.addXp(fulfilled.priceEach * fulfilled.quantity * SELL_XP_PER_COIN);
      });
      row.appendChild(button);
      rows.appendChild(row);
    });
  };

  render();
  const unsubscribeOrders = deps.orders.subscribe(render);
  const unsubscribeInv = deps.inventory.subscribe(render);

  return () => {
    unsubscribeOrders();
    unsubscribeInv();
    panel.remove();
  };
}
