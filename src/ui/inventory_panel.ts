// Inventory list. Re-renders every entry on change; with the Phase 3 item
// catalog (≤ 10 items) the cost is negligible. Switch to per-row updates in
// Phase 4 if the catalog grows.

import type { Inventory } from "../state/inventory";
import { getItemDef, type ItemId } from "../state/items";

export function createInventoryPanel(parent: HTMLElement, inventory: Inventory): () => void {
  const panel = document.createElement("div");
  panel.className = "ss-panel ss-inv";
  panel.innerHTML = `<h3>Inventory</h3><div data-field="rows"></div>`;
  parent.appendChild(panel);

  const rowsEl = panel.querySelector('[data-field="rows"]') as HTMLDivElement;

  const render = (): void => {
    const entries: Array<[ItemId, number]> = Array.from(inventory.entries()).sort(
      (a, b) => a[0] - b[0],
    );
    if (entries.length === 0) {
      rowsEl.innerHTML = `<div class="ss-empty">empty</div>`;
      return;
    }
    rowsEl.innerHTML = entries
      .map(([id, count]) => {
        const def = getItemDef(id);
        return `<div class="ss-row"><span>${def.displayName}</span><span>${count}</span></div>`;
      })
      .join("");
  };

  render();
  const unsubscribe = inventory.subscribe(render);

  return () => {
    unsubscribe();
    panel.remove();
  };
}
