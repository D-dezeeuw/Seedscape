// Shop menu — seed shop and building shop in one panel. Player level decides
// what's listed; locked items show but are disabled. Buying a seed adds it
// to inventory; buying a building arms the build tool with that selection.

import type { ToolState } from "../input/tool";
import type { Inventory } from "../state/inventory";
import { getItemDef, type ItemId } from "../state/items";
import type { Player } from "../state/player";
import { isBuildingUnlocked, isSeedUnlocked } from "../state/unlocks";
import { listBuildings } from "../world/farming/building_registry";

interface ShopDeps {
  parent: HTMLElement;
  inventory: Inventory;
  player: Player;
  tool: ToolState;
}

// Per-seed prices in coins. Match the basePrice in items.ts so seed → produce
// → sell rough math: 1 wheat seed (1c) → ~2-4 wheat (2c each) → ~4-8c.
const SEED_OFFERS: ReadonlyArray<ItemId> = [600, 608, 616] as ItemId[];

export function createShopMenu(deps: ShopDeps): () => void {
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

  const render = (): void => {
    const level = deps.player.level;
    const coins = deps.player.coins;

    seedsEl.innerHTML = "";
    for (const seedId of SEED_OFFERS) {
      const def = getItemDef(seedId);
      const unlocked = isSeedUnlocked(level, seedId);
      const price = def.basePrice;
      const row = document.createElement("div");
      row.className = "ss-shop-row";
      row.innerHTML = `<span>${def.displayName} <span class="ss-dim">${price}c</span></span>`;
      const btn = document.createElement("button");
      btn.className = "ss-btn ss-btn-buy";
      btn.textContent = unlocked ? "Buy" : "Locked";
      btn.disabled = !unlocked || coins < price;
      btn.addEventListener("click", () => {
        if (!deps.player.spendCoins(price)) return;
        deps.inventory.add(seedId, 1);
      });
      row.appendChild(btn);
      seedsEl.appendChild(row);
    }

    buildingsEl.innerHTML = "";
    for (const def of listBuildings()) {
      const unlocked = isBuildingUnlocked(level, def.id);
      const row = document.createElement("div");
      row.className = "ss-shop-row";
      row.innerHTML = `<span>${def.displayName} <span class="ss-dim">${def.placementCost}c</span></span>`;
      const btn = document.createElement("button");
      btn.className = "ss-btn ss-btn-buy";
      btn.textContent = unlocked ? "Build" : "Locked";
      btn.disabled = !unlocked || coins < def.placementCost;
      btn.addEventListener("click", () => {
        // Arm the build tool — coins are deducted on placement, not on
        // selecting, so the player can cancel by switching tools.
        deps.tool.selectBuilding(def.id);
      });
      row.appendChild(btn);
      buildingsEl.appendChild(row);
    }
  };

  render();
  const unsubscribePlayer = deps.player.subscribe(render);
  const unsubscribeInv = deps.inventory.subscribe(render);

  return () => {
    unsubscribePlayer();
    unsubscribeInv();
    panel.remove();
  };
}
