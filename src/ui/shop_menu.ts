// Shop menu — seeds, buildings, animals, supplies in one window. Player
// level decides what's listed; locked items show but are disabled.
//
// - Seeds + Animal Feed: spend coins, item lands in inventory.
// - Buildings + Pens: spend coins is deferred to placement; the Build
//   button arms the build tool with that id. Closing the Shop drops
//   the selection (window mutex in window.ts).
// - Animals: spend coins immediately, the new entity spawns at the
//   nearest empty pen of matching species. No empty pen → nothing
//   spawned, coins refunded, toast warns the player to build a pen.
//
// Rows are built once on open and only the mutable parts (button label
// + disabled state) update on each player/inventory change. Avoids
// detaching/recreating a dozen DOM nodes every coin tick.

import type { ToolState } from "../input/tool";
import type { Inventory } from "../state/inventory";
import { getItemDef, ITEM_IDS, type ItemId } from "../state/items";
import type { Player } from "../state/player";
import { isBuildingUnlocked, isSeedUnlocked } from "../state/unlocks";
import { listBuildings } from "../world/farming/building_registry";
import { listPens } from "../world/farming/pen_registry";
import { makeWindow, type UiWindow } from "./window";

interface ShopDeps {
  parent: HTMLElement;
  inventory: Inventory;
  player: Player;
  tool: ToolState;
  // Buy-an-animal callback — caller (main.ts) owns the chunk + entity
  // managers. Returns "ok" on a successful spawn or a reason string the
  // shop can surface as a toast. The shop already deducted coins on
  // success; on failure the coins are refunded by the callback returning
  // a non-"ok" status BEFORE the deduction (caller's contract).
  onBuyAnimal: (species: "chicken" | "cow", price: number) => "ok" | "no-pen" | "no-coins";
  // Optional toaster for "no empty pen" / "carry full" feedback.
  toast?: (message: string) => void;
}

const SEED_OFFERS: ReadonlyArray<ItemId> = [600, 608, 616] as ItemId[];

interface AnimalOffer {
  species: "chicken" | "cow";
  displayName: string;
  price: number;
  // Match the unlock id of the matching pen — selling an animal whose
  // pen is locked makes no sense. The chicken_pen building unlock at
  // level 4 also gates buying a chicken.
  penUnlockBuildingId: number;
}

const ANIMAL_OFFERS: ReadonlyArray<AnimalOffer> = [
  { species: "chicken", displayName: "Chicken", price: 50, penUnlockBuildingId: 400 },
  { species: "cow", displayName: "Cow", price: 200, penUnlockBuildingId: 410 },
];

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
    // Mirror the armed state of the build tool — toggling the row's
    // .ss-active class so the player can tell at a glance which entry
    // is in flight. Cleared automatically when the shop closes (the
    // toolbar-window close handler resets the tool to "none").
    const armed = tool.current === "build" && tool.selectedBuildingId === buildingId;
    row.classList.toggle("ss-active", armed);
  };
}

function buildAnimalRow(
  parent: HTMLElement,
  offer: AnimalOffer,
  deps: ShopDeps,
): RowUpdate {
  const row = document.createElement("div");
  row.className = "ss-shop-row";
  row.innerHTML = `<span>${offer.displayName} <span class="ss-dim">${offer.price}c</span></span>`;
  const btn = document.createElement("button");
  btn.className = "ss-btn ss-btn-buy";
  btn.addEventListener("click", () => {
    const status = deps.onBuyAnimal(offer.species, offer.price);
    if (status === "no-pen") {
      deps.toast?.(`Place a ${offer.displayName} pen first.`);
    } else if (status === "no-coins") {
      deps.toast?.(`Need ${offer.price}c.`);
    }
  });
  row.appendChild(btn);
  parent.appendChild(row);

  return (p: Player): void => {
    const unlocked = isBuildingUnlocked(p.level, offer.penUnlockBuildingId);
    const label = unlocked ? "Buy" : "Locked";
    if (btn.textContent !== label) btn.textContent = label;
    btn.disabled = !unlocked || p.coins < offer.price;
  };
}

function buildItemRow(
  parent: HTMLElement,
  itemId: ItemId,
  player: Player,
  inventory: Inventory,
  unlockGate?: (level: number) => boolean,
): RowUpdate {
  const def = getItemDef(itemId);
  const price = def.basePrice;
  const row = document.createElement("div");
  row.className = "ss-shop-row";
  row.innerHTML = `<span>${def.displayName} <span class="ss-dim">${price}c</span></span>`;
  const btn = document.createElement("button");
  btn.className = "ss-btn ss-btn-buy";
  btn.addEventListener("click", () => {
    if (!player.spendCoins(price)) return;
    inventory.add(itemId, 1);
  });
  row.appendChild(btn);
  parent.appendChild(row);

  return (p: Player): void => {
    const unlocked = unlockGate ? unlockGate(p.level) : true;
    const label = unlocked ? "Buy" : "Locked";
    if (btn.textContent !== label) btn.textContent = label;
    btn.disabled = !unlocked || p.coins < price;
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
    <div class="ss-subhead">Animal pens</div>
    <div data-field="pens"></div>
    <div class="ss-subhead">Animals</div>
    <div data-field="animals"></div>
    <div class="ss-subhead">Supplies</div>
    <div data-field="supplies"></div>
  `;
  deps.parent.appendChild(panel);
  const seedsEl = panel.querySelector('[data-field="seeds"]') as HTMLDivElement;
  const buildingsEl = panel.querySelector('[data-field="buildings"]') as HTMLDivElement;
  const pensEl = panel.querySelector('[data-field="pens"]') as HTMLDivElement;
  const animalsEl = panel.querySelector('[data-field="animals"]') as HTMLDivElement;
  const suppliesEl = panel.querySelector('[data-field="supplies"]') as HTMLDivElement;

  const updates: RowUpdate[] = [];
  for (const seedId of SEED_OFFERS) {
    updates.push(buildSeedRow(seedsEl, seedId, deps.player, deps.inventory));
  }
  for (const def of listBuildings()) {
    updates.push(
      buildBuildingRow(buildingsEl, def.id, def.displayName, def.placementCost, deps.tool),
    );
  }
  // Pens use the same Build flow as buildings — the build tool routes
  // 400-499 ids into setPenTile (see tile_interaction).
  for (const def of listPens()) {
    updates.push(
      buildBuildingRow(pensEl, def.tileId, def.displayName, def.placementCost, deps.tool),
    );
  }
  for (const offer of ANIMAL_OFFERS) {
    updates.push(buildAnimalRow(animalsEl, offer, deps));
  }
  // Animal feed has no unlock — it's only useful with a pen, but the
  // pen unlock already gates the buy-animal button so a player can't
  // pre-buy feed for a future-pen by accident in any meaningful way.
  updates.push(buildItemRow(suppliesEl, ITEM_IDS.ANIMAL_FEED, deps.player, deps.inventory));

  const refresh = (): void => {
    for (const u of updates) u(deps.player);
  };

  refresh();
  const unsubscribePlayer = deps.player.subscribe(refresh);
  const unsubscribeInv = deps.inventory.subscribe(refresh);
  // Tool changes flip the armed-row highlight on Build / pen rows.
  const unsubscribeTool = deps.tool.subscribe(refresh);

  return makeWindow(panel, () => {
    unsubscribePlayer();
    unsubscribeInv();
    unsubscribeTool();
  });
}
