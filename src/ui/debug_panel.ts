// Debug panel — quick buttons that mutate game state for manual testing.
// Mounted only when import.meta.env.DEV is true; tree-shaken out of
// production builds. Extend with more buttons here as testing needs grow.
//
// Collapsed state persists in localStorage so reloading mid-test keeps the
// panel in whatever shape it was last left.

import type { Inventory } from "../state/inventory";
import { ITEM_IDS } from "../state/items";
import type { Player } from "../state/player";

interface DebugPanelDeps {
  parent: HTMLElement;
  player: Player;
  inventory: Inventory;
}

const COLLAPSED_KEY = "ss-debug-collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // Some embedded browsers throw on localStorage writes — ignore.
  }
}

export function createDebugPanel(deps: DebugPanelDeps): () => void {
  const panel = document.createElement("div");
  panel.className = "ss-panel ss-debug";
  panel.innerHTML = `
    <h3 class="ss-debug-toggle" data-act="toggle">
      <span data-field="chevron">▾</span> Debug
    </h3>
    <div data-field="body">
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
    </div>
  `;
  deps.parent.appendChild(panel);

  const body = panel.querySelector('[data-field="body"]') as HTMLElement;
  const chevron = panel.querySelector('[data-field="chevron"]') as HTMLElement;

  let collapsed = readCollapsed();
  const applyCollapsed = (): void => {
    body.style.display = collapsed ? "none" : "";
    chevron.textContent = collapsed ? "▸" : "▾";
  };
  applyCollapsed();

  const handler = (event: Event): void => {
    // Resolve the closest [data-act] ancestor — handles clicks on the
    // chevron span inside the h3 toggle.
    const trigger = (event.target as HTMLElement | null)?.closest(
      "[data-act]",
    ) as HTMLElement | null;
    const action = trigger?.dataset.act;
    if (!action) return;
    switch (action) {
      case "toggle":
        collapsed = !collapsed;
        writeCollapsed(collapsed);
        applyCollapsed();
        return;
      case "coins-add":
        deps.player.addCoins(10);
        return;
      case "coins-sub":
        // spendCoins is a no-op when the balance is too low — debug-friendly.
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
        // Use the public xp setter — Player.setXp recomputes level on the
        // way out, same as load-from-save.
        deps.player.xp = 0;
        return;
    }
  };
  panel.addEventListener("click", handler);

  return () => {
    panel.removeEventListener("click", handler);
    panel.remove();
  };
}
