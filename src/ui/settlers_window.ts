// Settlers window — list of all Villager entities currently in the world.
// Each row shows the name (or "Settler" if not yet known) and a "Go to"
// button that pans the camera to the villager's position with a smooth
// glide. Subscribes to EntityManager so adds/removes refresh the list.

import type { EntityManager } from "../state/entities/entity_manager";
import { Villager } from "../state/entities/villager";
import { makeWindow, type UiWindow } from "./window";

interface Deps {
  parent: HTMLElement;
  entityManager: EntityManager;
  // Animated pan to a world-space position.
  onGoTo: (worldX: number, worldY: number) => void;
}

export function createSettlersWindow(deps: Deps): UiWindow {
  const panel = document.createElement("div");
  panel.className = "ss-panel ss-settlers";
  panel.innerHTML = `<h3>Settlers</h3><div data-field="rows"></div>`;
  deps.parent.appendChild(panel);
  const rowsEl = panel.querySelector('[data-field="rows"]') as HTMLDivElement;

  const render = (): void => {
    const villagers: Villager[] = [];
    for (const e of deps.entityManager.iterate()) {
      if (e instanceof Villager) villagers.push(e);
    }
    if (villagers.length === 0) {
      rowsEl.innerHTML = `<div class="ss-empty">no settlers yet</div>`;
      return;
    }
    rowsEl.innerHTML = "";
    for (const v of villagers) {
      const row = document.createElement("div");
      row.className = "ss-row";
      const label = document.createElement("span");
      // Default to "Settler" when no name has been chosen — placeholder
      // until the rename / introduction system ships.
      label.textContent = v.name || "Settler";
      const btn = document.createElement("button");
      btn.className = "ss-btn ss-btn-buy";
      btn.textContent = "Go to";
      btn.addEventListener("click", () => {
        deps.onGoTo(v.worldX(), v.worldY());
      });
      row.appendChild(label);
      row.appendChild(btn);
      rowsEl.appendChild(row);
    }
  };

  render();
  const unsubscribe = deps.entityManager.subscribe(render);

  return makeWindow(panel, unsubscribe);
}
