// Floating seed-row that appears above the toolbar while the plant tool
// is active. Each entry shows a seed name + the count carried; clicking
// arms tool.selectedSeedId so the next plant click drops that specific
// seed instead of whatever was first in the priority list.
//
// Hidden when the tool isn't "plant" or when the player has zero
// unlocked seeds with non-zero count. Also auto-picks the most-carried
// seed on entering plant mode so a player who just clicks the Plant
// tool button doesn't have to also click a seed before they can act.
//
// Re-renders on tool / inventory / player changes — cheap, the seed
// list is a handful of buttons.

import type { ToolState } from "../input/tool";
import type { Inventory } from "../state/inventory";
import { getItemDef, ITEM_IDS, type ItemId } from "../state/items";
import type { Player } from "../state/player";
import { isSeedUnlocked } from "../state/unlocks";

interface Deps {
  parent: HTMLElement;
  tool: ToolState;
  inventory: Inventory;
  player: Player;
}

const SEED_OPTIONS: ItemId[] = [ITEM_IDS.WHEAT_SEED, ITEM_IDS.CARROT_SEED, ITEM_IDS.CORN_SEED];

export function createPlantSeedSelector(deps: Deps): () => void {
  const row = document.createElement("div");
  row.className = "ss-plant-selector";
  row.style.display = "none";
  deps.parent.appendChild(row);

  // Auto-pick the seed the player carries the most of (among unlocked)
  // when entering plant mode without a valid selection. Keeps the UI
  // self-priming so the action button is meaningful from the first
  // click after switching tools.
  const ensureSelection = (): void => {
    if (deps.tool.current !== "plant") return;
    const cur = deps.tool.selectedSeedId;
    if (cur !== null && isSeedUnlocked(deps.player.level, cur) && deps.inventory.count(cur) > 0) {
      return;
    }
    let bestId: ItemId | null = null;
    let bestCount = 0;
    for (const id of SEED_OPTIONS) {
      if (!isSeedUnlocked(deps.player.level, id)) continue;
      const c = deps.inventory.count(id);
      if (c > bestCount) {
        bestId = id;
        bestCount = c;
      }
    }
    if (bestId !== null) deps.tool.selectSeed(bestId);
  };

  const render = (): void => {
    if (deps.tool.current !== "plant") {
      row.style.display = "none";
      return;
    }
    row.innerHTML = "";
    let visible = 0;
    const selected = deps.tool.selectedSeedId;
    for (const id of SEED_OPTIONS) {
      if (!isSeedUnlocked(deps.player.level, id)) continue;
      const count = deps.inventory.count(id);
      const def = getItemDef(id);
      const btn = document.createElement("button");
      btn.className = "ss-btn";
      if (id === selected && count > 0) btn.classList.add("ss-active");
      btn.disabled = count === 0;
      btn.textContent = `${def.displayName} (${count})`;
      btn.addEventListener("click", () => {
        if (count === 0) return;
        deps.tool.selectSeed(id);
      });
      row.appendChild(btn);
      visible++;
    }
    row.style.display = visible === 0 ? "none" : "";
  };

  const onChange = (): void => {
    ensureSelection();
    render();
  };
  onChange();

  const offTool = deps.tool.subscribe(onChange);
  const offInv = deps.inventory.subscribe(onChange);
  const offPlayer = deps.player.subscribe(onChange);

  return () => {
    offTool();
    offInv();
    offPlayer();
    row.remove();
  };
}
