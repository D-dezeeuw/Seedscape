// Settlers window — list of every Villager in the world. Each row is a
// pair of actions: clicking the name opens the Person window for that
// villager; clicking "Go to" pans the camera to them.
//
// Rows are keyed by villager id and reused across refreshes — only new
// villagers create new DOM, gone villagers' rows are removed, and the
// label text is patched on rename. Avoids the listener churn of
// rebuilding every row on every EntityManager add/remove (Phase 7's job
// system will spawn/despawn drone units in tighter loops).

import type { EntityManager } from "../state/entities/entity_manager";
import { Villager } from "../state/entities/villager";
import { makeWindow, type UiWindow } from "./window";

interface Deps {
  parent: HTMLElement;
  entityManager: EntityManager;
  onSelect: (villager: Villager) => void;
  onGoTo: (worldX: number, worldY: number) => void;
}

interface RowHandle {
  root: HTMLDivElement;
  label: HTMLButtonElement;
  // Captured so the row can be re-pointed at a renamed/repositioned
  // villager without rebinding the click handlers.
  villager: Villager;
}

function buildRow(deps: Deps, v: Villager): RowHandle {
  const row = document.createElement("div");
  row.className = "ss-row";

  const label = document.createElement("button");
  label.className = "ss-text-link";
  label.textContent = v.name || "Settler";
  label.addEventListener("click", () => deps.onSelect(handle.villager));

  const goTo = document.createElement("button");
  goTo.className = "ss-btn ss-btn-buy";
  goTo.textContent = "Go to";
  goTo.addEventListener("click", () => {
    deps.onGoTo(handle.villager.worldX(), handle.villager.worldY());
  });

  row.appendChild(label);
  row.appendChild(goTo);

  const handle: RowHandle = { root: row, label, villager: v };
  return handle;
}

export function createSettlersWindow(deps: Deps): UiWindow {
  const panel = document.createElement("div");
  panel.className = "ss-panel ss-settlers";
  panel.innerHTML = `
    <h3>Settlers</h3>
    <div data-field="empty" class="ss-empty">no settlers yet</div>
    <div data-field="rows"></div>
  `;
  deps.parent.appendChild(panel);
  const emptyEl = panel.querySelector('[data-field="empty"]') as HTMLDivElement;
  const rowsEl = panel.querySelector('[data-field="rows"]') as HTMLDivElement;

  const rows = new Map<number, RowHandle>();

  const render = (): void => {
    const seen = new Set<number>();
    let count = 0;
    for (const e of deps.entityManager.iterate()) {
      if (!(e instanceof Villager)) continue;
      seen.add(e.id);
      count++;
      let handle = rows.get(e.id);
      if (!handle) {
        handle = buildRow(deps, e);
        rows.set(e.id, handle);
        rowsEl.appendChild(handle.root);
      } else {
        // Re-point the captured villager (handles in-place id reuse from
        // save/load) and patch the label if the name changed since last
        // render.
        handle.villager = e;
        const label = e.name || "Settler";
        if (handle.label.textContent !== label) handle.label.textContent = label;
      }
    }
    // Remove rows for villagers that no longer exist.
    for (const [id, handle] of rows) {
      if (!seen.has(id)) {
        handle.root.remove();
        rows.delete(id);
      }
    }
    // Empty placeholder vs row list — show one or the other.
    emptyEl.style.display = count === 0 ? "" : "none";
    rowsEl.style.display = count === 0 ? "none" : "";
  };

  render();
  const unsubscribe = deps.entityManager.subscribe(render);

  return makeWindow(panel, () => {
    unsubscribe();
    rows.clear();
  });
}
