// Shop menu — seed shop and building shop in one window. Player level decides
// what's listed; locked items show but are disabled. Buying a seed adds it
// to inventory; buying a building arms the build tool with that selection.
//
// Rows are built once on open and only the mutable parts (button label +
// disabled state) update on each player/inventory change. Avoids
// detaching/recreating a dozen DOM nodes every coin tick.

import type { ToolState } from "../input/tool";
import type { Inventory } from "../state/inventory";
import { getItemDef, type ItemId } from "../state/items";
import type { Player } from "../state/player";
import { isBuildingUnlocked, isSeedUnlocked } from "../state/unlocks";
import { listBuildings } from "../world/farming/building_registry";
import { makeWindow, type UiWindow } from "./window";

interface ShopDeps {
  parent: HTMLElement;
  inventory: Inventory;
  player: Player;
  tool: ToolState;
}

const SEED_OFFERS: ReadonlyArray<ItemId> = [600, 608, 616] as ItemId[];

// Per-row update function — closes over the row's button and computes its
// next label/disabled state from current player + inventory. Returned by
// the row builders and called inside refresh() for each row.
type RowUpdate = (player: Player) => void;

function buildSeedRow(
  parent: HTMLElement,
  seedId: ItemId,
  player: Player,
  inventory: Inventory,
): RowUpdate {
  const def = getItemDef(seedId);
  const price = def.basePrice;
  const row = document.createElement("div");
  row.className = "ss-shop-row";
  row.innerHTML = `<span>${def.displayName} <span class="ss-dim">${price}c</span></span>`;
  const btn = document.createElement("button");
  btn.className = "ss-btn ss-btn-buy";
  btn.addEventListener("click", () => {
    if (!player.spendCoins(price)) return;
    inventory.add(seedId, 1);
  });
  row.appendChild(btn);
  parent.appendChild(row);

  return (p: Player): void => {
    const unlocked = isSeedUnlocked(p.level, seedId);
    const label = unlocked ? "Buy" : "Locked";
    if (btn.textContent !== label) btn.textContent = label;
    btn.disabled = !unlocked || p.coins < price;
  };
}

function buildBuildingRow(
  parent: HTMLElement,
  buildingId: number,
  displayName: string,
  placementCost: number,
  tool: ToolState,
): RowUpdate {
  const row = document.createElement("div");
  row.className = "ss-shop-row";
  row.innerHTML = `<span>${displayName} <span class="ss-dim">${placementCost}c</span></span>`;
  const btn = document.createElement("button");
  btn.className = "ss-btn ss-btn-buy";
  btn.addEventListener("click", () => {
    tool.selectBuilding(buildingId);
  });
  row.appendChild(btn);
  parent.appendChild(row);

  return (p: Player): void => {
    const unlocked = isBuildingUnlocked(p.level, buildingId);
    const label = unlocked ? "Build" : "Locked";
    if (btn.textContent !== label) btn.textContent = label;
    btn.disabled = !unlocked || p.coins < placementCost;
  };
}

export function createShopMenu(deps: ShopDeps): UiWindow {
  const panel = document.createElement("div");
  panel.className = "ss-panel ss-shop";
  panel.innerHTML = `
    <h3>Shop</h3>
    <div class="ss-subhead">Seeds</div>
    <div data-field="seeds"></div>
    <div class="ss-subhead">Buildings</div>
    <div data-field="buildings"></div>
  `;
  deps.parent.appendChild(panel);
  const seedsEl = panel.querySelector('[data-field="seeds"]') as HTMLDivElement;
  const buildingsEl = panel.querySelector('[data-field="buildings"]') as HTMLDivElement;

  const updates: RowUpdate[] = [];
  for (const seedId of SEED_OFFERS) {
    updates.push(buildSeedRow(seedsEl, seedId, deps.player, deps.inventory));
  }
  for (const def of listBuildings()) {
    updates.push(
      buildBuildingRow(buildingsEl, def.id, def.displayName, def.placementCost, deps.tool),
    );
  }

  const refresh = (): void => {
    for (const u of updates) u(deps.player);
  };

  refresh();
  const unsubscribePlayer = deps.player.subscribe(refresh);
  const unsubscribeInv = deps.inventory.subscribe(refresh);

  return makeWindow(panel, () => {
    unsubscribePlayer();
    unsubscribeInv();
  });
}
