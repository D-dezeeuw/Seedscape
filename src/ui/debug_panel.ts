// Debug panel — quick buttons that mutate game state for manual testing.
// Mounted only when import.meta.env.DEV is true; tree-shaken out of
// production builds. Extend with more buttons here as testing needs grow
// (e.g. when a phase introduces new gameplay state worth poking at).

import type { Camera } from "../input/camera";
import type { EntityManager } from "../state/entities/entity_manager";
import { pickFullName } from "../state/entities/names";
import { Villager } from "../state/entities/villager";
import type { Inventory } from "../state/inventory";
import { ITEM_IDS } from "../state/items";
import type { Player } from "../state/player";
import {
  CHUNK_FLAG_DIRTY_RENDER,
  CHUNK_FLAG_DIRTY_SIMULATION,
  CHUNK_SIZE,
  tileIndex,
} from "../world/chunk";
import type { ChunkManager } from "../world/chunk_manager";
import { SEED_DISPENSER_TILE_ID } from "../world/farming/container_registry";
import { CRATE_TILE_ID, type CrateStore } from "../world/farming/crate";
import { CROP_STAGE_HARVESTABLE } from "../world/farming/crop_registry";
import { makeWindow, type UiWindow } from "./window";

interface DebugPanelDeps {
  parent: HTMLElement;
  player: Player;
  inventory: Inventory;
  entityManager: EntityManager;
  camera: Camera;
  chunkManager: ChunkManager;
  crates: CrateStore;
  // Hook for the toaster so the user gets feedback when stress actions run
  // (placing crops, spawning settlers — these are silent otherwise).
  toast?: (message: string) => void;
}

const WHEAT_BASE_ID = 100;
const TILE_DRY_GRASS = 10;
const TILE_FARMLAND_TILLED = 13;

export function createDebugPanel(deps: DebugPanelDeps): UiWindow {
  const panel = document.createElement("div");
  panel.className = "ss-panel ss-debug";
  panel.innerHTML = `
    <h3>Debug</h3>
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
    <div class="ss-subhead">Entities</div>
    <div class="ss-debug-row">
      <button class="ss-btn" data-act="settler-to-camera">Settler → camera</button>
    </div>
    <div class="ss-subhead">Stress test (Phase 7)</div>
    <div class="ss-debug-row">
      <button class="ss-btn" data-act="stress-setup">Setup farm at camera</button>
    </div>
    <div class="ss-debug-row">
      <button class="ss-btn" data-act="spawn-25">+25 settlers</button>
      <button class="ss-btn" data-act="spawn-50">+50 settlers</button>
      <button class="ss-btn" data-act="spawn-150">+150 settlers</button>
    </div>
    <div class="ss-debug-row">
      <button class="ss-btn" data-act="clear-settlers">Clear villagers</button>
    </div>
  `;
  deps.parent.appendChild(panel);

  const handler = (event: Event): void => {
    const trigger = (event.target as HTMLElement | null)?.closest(
      "[data-act]",
    ) as HTMLElement | null;
    const action = trigger?.dataset.act;
    if (!action) return;
    switch (action) {
      case "coins-add":
        deps.player.addCoins(10);
        return;
      case "coins-sub":
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
        deps.player.xp = 0;
        return;
      case "settler-to-camera": {
        // Pick the first villager and yank them to the camera center —
        // useful when the wander target took them off-screen.
        for (const e of deps.entityManager.iterate()) {
          if (e instanceof Villager) {
            e.setWorldPosition(deps.camera.x, deps.camera.y);
            return;
          }
        }
        return;
      }
      case "stress-setup": {
        const placed = setupStressFarm(deps);
        deps.toast?.(
          `Stress farm: ${placed.crops} ripe + ${placed.tilled} empty tilled, ${placed.crates} crates, ${placed.dispensers} dispenser`,
        );
        return;
      }
      case "spawn-25":
        spawnSettlersAroundCamera(deps, 25);
        deps.toast?.("Spawned 25 settlers");
        return;
      case "spawn-50":
        spawnSettlersAroundCamera(deps, 50);
        deps.toast?.("Spawned 50 settlers");
        return;
      case "spawn-150":
        spawnSettlersAroundCamera(deps, 150);
        deps.toast?.("Spawned 150 settlers");
        return;
      case "clear-settlers": {
        const removed = clearVillagers(deps);
        deps.toast?.(`Removed ${removed} villagers`);
        return;
      }
    }
  };
  panel.addEventListener("click", handler);

  return makeWindow(panel, () => {
    panel.removeEventListener("click", handler);
  });
}

// ---------------- Stress-test helpers ----------------

// Layout for a self-sufficient stress scenario near the camera:
//   - A 16×16 zone of ripe wheat tiles (256 tiles, but we sparse-fill
//     ~half so settlers don't all converge on the exact same spot)
//   - 4 crates in a square around the zone for harvest deposits
// The placements only modify chunks that already exist in the cache —
// uncached chunks are silently skipped (the camera should be on them
// already, so this rarely matters).
function setupStressFarm(deps: DebugPanelDeps): {
  crops: number;
  tilled: number;
  crates: number;
  dispensers: number;
} {
  const cx0 = Math.floor(deps.camera.x);
  const cy0 = Math.floor(deps.camera.y);
  const dirty = new Set<string>();

  const writeTile = (wx: number, wy: number, tileId: number, state = 0): boolean => {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cy = Math.floor(wy / CHUNK_SIZE);
    const rec = deps.chunkManager.peekChunk(cx, cy);
    if (!rec) return false;
    const lx = wx - cx * CHUNK_SIZE;
    const ly = wy - cy * CHUNK_SIZE;
    const i = tileIndex(lx, ly);
    rec.data.tileId[i] = tileId;
    rec.data.state[i] = state;
    rec.data.metadata[i] = 0;
    dirty.add(`${cx},${cy}`);
    return true;
  };

  let crops = 0;
  let tilled = 0;
  // 16×16 zone, alternating ripe wheat (even cells) + empty tilled
  // (odd cells). Empty tilled tiles trigger PLANT_SEED jobs so settlers
  // exercise the haul-seed → plant flow alongside harvest.
  for (let dy = -8; dy < 8; dy++) {
    for (let dx = -8; dx < 8; dx++) {
      writeTile(cx0 + dx, cy0 + dy, TILE_DRY_GRASS);
      if ((dx + dy) % 2 === 0) {
        if (writeTile(cx0 + dx, cy0 + dy, WHEAT_BASE_ID, CROP_STAGE_HARVESTABLE)) crops++;
      } else {
        if (writeTile(cx0 + dx, cy0 + dy, TILE_FARMLAND_TILLED, 0)) tilled++;
      }
    }
  }

  let crates = 0;
  const cratePositions: Array<{ x: number; y: number }> = [
    { x: cx0 - 10, y: cy0 - 10 },
    { x: cx0 + 10, y: cy0 - 10 },
    { x: cx0 - 10, y: cy0 + 10 },
    { x: cx0 + 10, y: cy0 + 10 },
  ];
  for (const p of cratePositions) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        writeTile(p.x + dx, p.y + dy, TILE_DRY_GRASS);
      }
    }
    if (writeTile(p.x, p.y, CRATE_TILE_ID)) crates++;
  }

  // One seed dispenser, pre-stocked. Auto-restock will keep topping it
  // up from the player's inventory each sim tick — we also push a stack
  // of seeds into the player's inventory directly so the autonomy loop
  // doesn't stall waiting for the shop.
  let dispensers = 0;
  const dispenserPos = { x: cx0, y: cy0 - 10 };
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      writeTile(dispenserPos.x + dx, dispenserPos.y + dy, TILE_DRY_GRASS);
    }
  }
  if (writeTile(dispenserPos.x, dispenserPos.y, SEED_DISPENSER_TILE_ID)) {
    dispensers++;
    // Pre-stock so the very first PLANT_SEED claim succeeds, instead of
    // waiting a full sim tick for the auto-restock pass.
    deps.crates.deposit(dispenserPos.x, dispenserPos.y, ITEM_IDS.WHEAT_SEED, 20);
    // Also pad the player inventory so the dispenser keeps filling as
    // settlers drain it.
    deps.inventory.add(ITEM_IDS.WHEAT_SEED, 200);
  }

  for (const key of dirty) {
    const [cx, cy] = key.split(",").map(Number) as [number, number];
    deps.chunkManager.markDirty(cx, cy, CHUNK_FLAG_DIRTY_RENDER | CHUNK_FLAG_DIRTY_SIMULATION);
  }
  return { crops, tilled, crates, dispensers };
}

function spawnSettlersAroundCamera(deps: DebugPanelDeps, count: number): void {
  const cx0 = Math.floor(deps.camera.x);
  const cy0 = Math.floor(deps.camera.y);
  // Spread in a sunflower spiral so settlers don't pile on one tile.
  // Radius grows with √n so density stays roughly constant.
  for (let i = 0; i < count; i++) {
    const angle = i * 2.39996; // golden-angle radians
    const r = Math.sqrt(i) * 0.8;
    const wx = cx0 + Math.cos(angle) * r;
    const wy = cy0 + Math.sin(angle) * r;
    const id = deps.entityManager.allocateId();
    // Mix the camera coords into the seed so successive "+25" presses
    // don't all roll the same names — id alone would collide with the
    // initial spawn ids on a fresh world. Camera nudges deduplicate
    // without making names time-dependent.
    const seed = id ^ ((cx0 * 73856093) ^ (cy0 * 19349663));
    const v = new Villager(
      id,
      {
        chunkX: Math.floor(wx / CHUNK_SIZE),
        chunkY: Math.floor(wy / CHUNK_SIZE),
        localX: ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE,
        localY: ((wy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE,
      },
      pickFullName(seed),
      { x: Math.floor(wx), y: Math.floor(wy) },
    );
    deps.entityManager.add(v);
  }
}

function clearVillagers(deps: DebugPanelDeps): number {
  const ids: number[] = [];
  for (const e of deps.entityManager.iterate()) {
    if (e instanceof Villager) ids.push(e.id);
  }
  for (const id of ids) deps.entityManager.remove(id);
  return ids.length;
}
