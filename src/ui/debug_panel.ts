// Debug panel — quick buttons that mutate game state for manual testing.
// Mounted only when import.meta.env.DEV is true; tree-shaken out of
// production builds. Extend with more buttons here as testing needs grow
// (e.g. when a phase introduces new gameplay state worth poking at).

import type { Inventory } from "../state/inventory";
import { ITEM_IDS } from "../state/items";
import type { Player } from "../state/player";
import { makeWindow, type UiWindow } from "./window";

interface DebugPanelDeps {
  parent: HTMLElement;
  player: Player;
  inventory: Inventory;
}

export function createDebugPanel(deps: DebugPanelDeps): UiWindow {
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
    <div class="ss-subhead">XP</div>
    <div class="ss-debug-row">
      <button class="ss-btn" data-act="xp-100">+100</button>
      <button class="ss-btn" data-act="xp-500">+500</button>
      <button class="ss-btn" data-act="xp-1000">+1000</button>
    </div>
    <div class="ss-debug-row">
      <button class="ss-btn" data-act="xp-reset">Reset XP</button>
    </div>
  `;
  deps.parent.appendChild(panel);

  const handler = (event: Event): void => {
    const trigger = (event.target as HTMLElement | null)?.closest(
      "[data-act]",
    ) as HTMLElement | null;
    const action = trigger?.dataset.act;
    if (!action) return;
    switch (action) {
      case "coins-add":
        deps.player.addCoins(10);
        return;
      case "coins-sub":
        deps.player.spendCoins(10);
        return;
      case "wheat-add":
        deps.inventory.add(ITEM_IDS.WHEAT, 10);
        return;
      case "wheat-sub":
        deps.inventory.remove(ITEM_IDS.WHEAT, 10);
        return;
      case "xp-100":
        deps.player.addXp(100);
        return;
      case "xp-500":
        deps.player.addXp(500);
        return;
      case "xp-1000":
        deps.player.addXp(1000);
        return;
      case "xp-reset":
        deps.player.xp = 0;
        return;
    }
  };
  panel.addEventListener("click", handler);

  return makeWindow(panel, () => {
    panel.removeEventListener("click", handler);
  });
}
