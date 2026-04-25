// Debug panel — quick buttons that mutate game state for manual testing.
// Mounted only when import.meta.env.DEV is true; tree-shaken out of
// production builds. Extend with more buttons here as testing needs grow.

import type { Inventory } from "../state/inventory";
import { ITEM_IDS } from "../state/items";
import type { Player } from "../state/player";

interface DebugPanelDeps {
  parent: HTMLElement;
  player: Player;
  inventory: Inventory;
}

export function createDebugPanel(deps: DebugPanelDeps): () => void {
  const panel = document.createElement("div");
  panel.className = "ss-panel ss-debug";
  panel.innerHTML = `
    <h3>Debug</h3>
    <div class="ss-subhead">Coins</div>
    <div class="ss-debug-row">
      <button class="ss-btn" data-act="coins-add">+10c</button>
      <button class="ss-btn" data-act="coins-sub">-10c</button>
    </div>
    <div class="ss-subhead">Wheat</div>
    <div class="ss-debug-row">
      <button class="ss-btn" data-act="wheat-add">+10</button>
      <button class="ss-btn" data-act="wheat-sub">-10</button>
    </div>
  `;
  deps.parent.appendChild(panel);

  const handler = (event: Event): void => {
    const target = event.target as HTMLElement | null;
    const action = target?.dataset?.act;
    if (!action) return;
    switch (action) {
      case "coins-add":
        deps.player.addCoins(10);
        return;
      case "coins-sub":
        // spendCoins is a no-op when the balance is too low — exactly the
        // behavior we want for the debug button (can't go negative).
        deps.player.spendCoins(10);
        return;
      case "wheat-add":
        deps.inventory.add(ITEM_IDS.WHEAT, 10);
        return;
      case "wheat-sub":
        deps.inventory.remove(ITEM_IDS.WHEAT, 10);
        return;
    }
  };
  panel.addEventListener("click", handler);

  return () => {
    panel.removeEventListener("click", handler);
    panel.remove();
  };
}
