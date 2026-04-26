// Settlers window — list of every Villager in the world. Each row is a
// pair of actions: clicking the name opens the Person window for that
// villager; clicking "Go to" pans the camera to them. Refreshes on
// EntityManager add/remove via subscribe.

import type { EntityManager } from "../state/entities/entity_manager";
import { Villager } from "../state/entities/villager";
import { makeWindow, type UiWindow } from "./window";

interface Deps {
  parent: HTMLElement;
  entityManager: EntityManager;
  onSelect: (villager: Villager) => void;
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
    rowsEl.innerHTML = "";
    if (villagers.length === 0) {
      rowsEl.innerHTML = `<div class="ss-empty">no settlers yet</div>`;
      return;
    }
    for (const v of villagers) {
      const row = document.createElement("div");
      row.className = "ss-row";

      const label = document.createElement("button");
      label.className = "ss-text-link";
      label.textContent = v.name || "Settler";
      label.addEventListener("click", () => deps.onSelect(v));

      const goTo = document.createElement("button");
      goTo.className = "ss-btn ss-btn-buy";
      goTo.textContent = "Go to";
      goTo.addEventListener("click", () => deps.onGoTo(v.worldX(), v.worldY()));

      row.appendChild(label);
      row.appendChild(goTo);
      rowsEl.appendChild(row);
    }
  };

  render();
  const unsubscribe = deps.entityManager.subscribe(render);

  return makeWindow(panel, unsubscribe);
}
