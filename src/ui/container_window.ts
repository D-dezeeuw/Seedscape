// Container window — opens when the player clicks a crate or seed
// dispenser tile in god mode, or presses E next to one while
// possessing a settler. Two-section layout:
//   - Container contents: items currently inside, with -1 / -10 / take-all
//     buttons that pull items into the active inventory.
//   - Active inventory (filtered by container.acceptsItem): items the
//     active side holds that this container can accept, with +1 / +10 /
//     give-all buttons that push them in.
//
// "Active inventory" is whichever InventoryLike was passed in:
//   - god mode → player's Inventory (unlimited count)
//   - possession → possessed Villager's carriedItems (weight-capped)
// The window doesn't know which one it has; it just trusts the
// adapter's clamp-and-return-actual semantics. Withdraw refunds any
// overflow back to the container so a settler at carry capacity
// doesn't drain the crate.
//
// Re-rendered on inventory.subscribe + a low-rate polling timer
// (CrateStore doesn't expose a subscription; the settler adapter
// doesn't either; both rely on the polling timer).

import type { InventoryLike } from "../state/inventory_like";
import { getItemDef, type ItemId } from "../state/items";
import { type ContainerDef, containerForTile } from "../world/farming/container_registry";
import type { CrateStore } from "../world/farming/crate";
import { makeWindow, type UiWindow } from "./window";

const REFRESH_HZ = 4;

export interface ContainerWindowDeps {
  parent: HTMLElement;
  // The "from-inventory" side of the transfer panel. Swap between
  // player and possessed-settler views by replacing this reference
  // (see setInventory below).
  inventory: InventoryLike;
  crates: CrateStore;
  // Helper to look up the live tile id at the open coords. Returns null
  // when the chunk has been evicted / the tile dismantled — the window
  // closes itself in that case.
  readTileId: (x: number, y: number) => number | null;
  // Optional toaster hook for transfer feedback.
  toast?: (message: string) => void;
}

export interface ContainerWindowApi {
  showFor: (x: number, y: number) => void;
  // Swap which inventory backs the "from-inventory" side. Lets one
  // window instance flip between player + possessed-settler modes
  // without re-allocating DOM. Triggers a re-render if open.
  setInventory: (inventory: InventoryLike) => void;
  destroy: () => void;
}

interface OpenTarget {
  x: number;
  y: number;
  tileId: number;
  def: ContainerDef;
}

export function createContainerWindow(deps: ContainerWindowDeps): ContainerWindowApi {
  const panel = document.createElement("div");
  panel.className = "ss-panel ss-container-window";
  panel.innerHTML = `
    <h3 data-field="title">Container</h3>
    <div class="ss-meta" data-field="meta"></div>
    <div class="ss-subhead">Contents</div>
    <div data-field="contents"></div>
    <div class="ss-subhead">From inventory</div>
    <div data-field="inventory"></div>
  `;
  deps.parent.appendChild(panel);

  const titleEl = panel.querySelector('[data-field="title"]') as HTMLElement;
  const metaEl = panel.querySelector('[data-field="meta"]') as HTMLElement;
  const contentsEl = panel.querySelector('[data-field="contents"]') as HTMLDivElement;
  const inventoryEl = panel.querySelector('[data-field="inventory"]') as HTMLDivElement;

  let target: OpenTarget | null = null;
  // Mutable so setInventory can swap between player + settler views.
  // Re-fetch on every render rather than capturing in closures.
  let activeInventory: InventoryLike = deps.inventory;
  let unsubscribeInventory: (() => void) | null = null;
  const window_ = makeWindow(panel, () => {});

  const render = (): void => {
    if (!target) return;
    // Verify the tile is still a container of the same kind. If the
    // player or a settler dismantled it mid-window, close cleanly.
    const liveTileId = deps.readTileId(target.x, target.y);
    if (liveTileId !== target.tileId) {
      window_.hide();
      return;
    }

    titleEl.textContent = displayNameFor(target.tileId);
    const total = deps.crates.totalAt(target.x, target.y);
    metaEl.textContent = `(${target.x}, ${target.y}) · ${total} items`;

    contentsEl.innerHTML = "";
    let any = false;
    // Iterate items deterministically (by id) so the row order is stable
    // across re-renders.
    const ids = collectContainerItems(target, deps.crates).sort((a, b) => a - b);
    for (const id of ids) {
      const count = deps.crates.countAt(target.x, target.y, id);
      if (count <= 0) continue;
      any = true;
      contentsEl.appendChild(buildRow(id, count, "withdraw", target, deps, () => activeInventory, render));
    }
    if (!any) {
      contentsEl.innerHTML = `<div class="ss-empty">empty</div>`;
    }

    inventoryEl.innerHTML = "";
    let anyDepositable = false;
    const invIds = Array.from(activeInventory.entries())
      .map(([id]) => id)
      .filter((id) => target!.def.acceptsItem(id))
      .sort((a, b) => a - b);
    for (const id of invIds) {
      const count = activeInventory.count(id);
      if (count <= 0) continue;
      anyDepositable = true;
      inventoryEl.appendChild(buildRow(id, count, "deposit", target, deps, () => activeInventory, render));
    }
    if (!anyDepositable) {
      inventoryEl.innerHTML = `<div class="ss-empty">no acceptable items in inventory</div>`;
    }
  };

  const refreshIntervalMs = Math.round(1000 / REFRESH_HZ);
  const refreshTimer = window.setInterval(() => {
    if (target && window_.isOpen()) render();
  }, refreshIntervalMs);

  const wireInventorySubscription = (): void => {
    unsubscribeInventory?.();
    unsubscribeInventory = activeInventory.subscribe?.(() => {
      if (target && window_.isOpen()) render();
    }) ?? null;
  };
  wireInventorySubscription();

  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key !== "Escape") return;
    if (!window_.isOpen()) return;
    window_.hide();
    ev.preventDefault();
  };
  globalThis.window.addEventListener("keydown", onKey);

  return {
    showFor(x: number, y: number) {
      const tileId = deps.readTileId(x, y);
      if (tileId === null) return;
      const def = containerForTile(tileId);
      if (!def) return;
      target = { x, y, tileId, def };
      render();
      if (!window_.isOpen()) window_.show();
    },
    setInventory(inventory: InventoryLike) {
      activeInventory = inventory;
      wireInventorySubscription();
      if (target && window_.isOpen()) render();
    },
    destroy() {
      globalThis.window.clearInterval(refreshTimer);
      globalThis.window.removeEventListener("keydown", onKey);
      unsubscribeInventory?.();
      window_.destroy();
    },
  };
}

// ---- helpers ----------------------------------------------------------

function displayNameFor(tileId: number): string {
  // Cheap reverse lookup. Two containers today; if this list grows, swap
  // for a registry entry on ContainerDef.
  if (tileId === 220) return "Storage Crate";
  if (tileId === 221) return "Seed Dispenser";
  return "Container";
}

// CrateStore doesn't expose contents iteration per-tile; iterate via
// crates() and filter to the tile we care about. Cheap for a window
// — at most a few crates worth of entries to walk.
function collectContainerItems(target: OpenTarget, crates: CrateStore): ItemId[] {
  const ids: ItemId[] = [];
  for (const c of crates.crates()) {
    if (c.x !== target.x || c.y !== target.y) continue;
    // We have the tile but no per-item iter — probe known item ids by
    // walking the shop catalog. The CrateStore API is awkward here;
    // future work could add `itemsAt(x, y)` to clean this up.
    break;
  }
  // Fallback: walk inventory item ids + any items already known to be
  // depositable for this container kind. For the current registry
  // (crate accepts anything; dispenser accepts seeds 600..699) this
  // covers everything we'll ever see in a container.
  const probe: ItemId[] = [
    600,
    608,
    616, // seeds
    700,
    708,
    716, // raw produce
    800,
    810, // processed goods
  ] as ItemId[];
  for (const id of probe) {
    if (crates.countAt(target.x, target.y, id) > 0) ids.push(id);
  }
  return ids;
}

function buildRow(
  itemId: ItemId,
  count: number,
  direction: "deposit" | "withdraw",
  target: OpenTarget,
  deps: ContainerWindowDeps,
  // Re-fetched per click so the active inventory survives a swap mid-
  // session (player ↔ settler) without invalidating already-rendered
  // rows.
  getInventory: () => import("../state/inventory_like").InventoryLike,
  rerender: () => void,
): HTMLDivElement {
  const def = getItemDef(itemId);
  const row = document.createElement("div");
  row.className = "ss-row";
  row.innerHTML = `
    <span>${def.displayName}</span>
    <span class="ss-row-actions">
      <span class="ss-row-count">${count}</span>
      <button class="ss-btn ss-btn-tight" data-amt="1">${direction === "deposit" ? "+1" : "−1"}</button>
      <button class="ss-btn ss-btn-tight" data-amt="10">${direction === "deposit" ? "+10" : "−10"}</button>
      <button class="ss-btn ss-btn-tight" data-amt="all">${direction === "deposit" ? "all" : "take"}</button>
    </span>
  `;
  row.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement | null)?.closest("[data-amt]") as HTMLElement | null;
    if (!btn) return;
    const inventory = getInventory();
    const raw = btn.dataset.amt as "1" | "10" | "all";
    const max = direction === "deposit" ? inventory.count(itemId) : count;
    const wanted = raw === "all" ? max : Number(raw);
    const amount = Math.min(max, wanted);
    if (amount <= 0) return;
    if (direction === "deposit") {
      const stored = deps.crates.deposit(target.x, target.y, itemId, amount);
      if (stored > 0) inventory.remove(itemId, stored);
      if (stored < amount) {
        deps.toast?.(`Container full — ${stored}/${amount} stored`);
      }
    } else {
      // Pull from the container, then try to put it into the active
      // inventory. The player's adapter accepts everything; the
      // settler's clamps by carry weight. Refund the overflow back
      // into the container so a possessed settler doesn't drain a
      // crate just because they're at capacity.
      const taken = deps.crates.withdraw(target.x, target.y, itemId, amount);
      if (taken > 0) {
        const accepted = inventory.add(itemId, taken);
        if (accepted < taken) {
          deps.crates.deposit(target.x, target.y, itemId, taken - accepted);
          deps.toast?.(`Carry full — took ${accepted}/${taken}`);
        }
      }
    }
    rerender();
  });
  return row;
}
