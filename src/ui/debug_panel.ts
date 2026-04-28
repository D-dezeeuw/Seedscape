// Debug panel — quick buttons that mutate game state for manual testing.
// Mounted only when import.meta.env.DEV is true; tree-shaken out of
// production builds. Extend with more buttons here as testing needs grow
// (e.g. when a phase introduces new gameplay state worth poking at).

import type { Camera } from "../input/camera";
import { Chicken, Cow } from "../state/entities/animal";
import type { EntityManager } from "../state/entities/entity_manager";
import { pickFullName } from "../state/entities/names";
import { Villager } from "../state/entities/villager";
import type { Inventory } from "../state/inventory";
import { ITEM_IDS } from "../state/items";
import type { Player } from "../state/player";
import { isDebugUnlockAll, setDebugUnlockAll } from "../state/unlocks";
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
import { TILE_CHICKEN_PEN, TILE_COW_PEN } from "../world/farming/pen_registry";
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
      <button class="ss-btn" data-act="coins-add">+100c</button>
      <button class="ss-btn" data-act="coins-sub">-100c</button>
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
    <div class="ss-subhead">Unlocks</div>
    <div class="ss-debug-row">
      <button class="ss-btn" data-act="unlock-all-toggle" data-field="unlock-all-label">Unlock all: OFF</button>
      <button class="ss-btn" data-act="give-all-seeds">+50 of every seed</button>
    </div>
    <div class="ss-subhead">Entities</div>
    <div class="ss-debug-row">
      <button class="ss-btn" data-act="settler-to-camera">Settler → camera</button>
    </div>
    <div class="ss-subhead">Stress test (Phase 7)</div>
    <div class="ss-debug-row">
      <button class="ss-btn" data-act="stress-setup">Setup farm at camera</button>
      <button class="ss-btn" data-act="stress-husbandry">Setup husbandry at camera</button>
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

  const unlockAllLabel = panel.querySelector(
    '[data-field="unlock-all-label"]',
  ) as HTMLElement | null;
  const refreshUnlockLabel = (): void => {
    if (unlockAllLabel) {
      unlockAllLabel.textContent = `Unlock all: ${isDebugUnlockAll() ? "ON" : "OFF"}`;
    }
  };
  refreshUnlockLabel();

  const handler = (event: Event): void => {
    const trigger = (event.target as HTMLElement | null)?.closest(
      "[data-act]",
    ) as HTMLElement | null;
    const action = trigger?.dataset.act;
    if (!action) return;
    switch (action) {
      case "coins-add":
        deps.player.addCoins(100);
        return;
      case "coins-sub":
        deps.player.spendCoins(100);
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
      case "unlock-all-toggle": {
        const next = !isDebugUnlockAll();
        setDebugUnlockAll(next);
        refreshUnlockLabel();
        deps.toast?.(`Unlock-all: ${next ? "ON" : "OFF"}`);
        return;
      }
      case "give-all-seeds": {
        // Drop 50 of each seed kind into inventory + a chunk of coins
        // so the player can immediately place anything they unlocked.
        // Uses the seed item ids directly to avoid hard-coding a list
        // here and missing future seeds.
        for (const id of [ITEM_IDS.WHEAT_SEED, ITEM_IDS.CARROT_SEED, ITEM_IDS.CORN_SEED]) {
          deps.inventory.add(id, 50);
        }
        deps.player.addCoins(1000);
        deps.toast?.("+50 of each seed, +1000c");
        return;
      }
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
      case "stress-husbandry": {
        const placed = setupStressHusbandry(deps);
        deps.toast?.(
          `Husbandry: ${placed.chickens} chickens, ${placed.cows} cows, ${placed.crates} crate (feed: ${placed.feed})`,
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

// Place a fully-stocked husbandry scenario near the camera: a 4×4
// chicken pen, a 4×4 cow pen, and a Storage Crate pre-stocked with
// animal feed. One animal spawns per pen tile (16 chickens + 16 cows)
// so the autonomous FEED_ANIMAL / COLLECT_PRODUCE jobs immediately
// have work — useful for stress-testing settler routing on the
// animal-haul side of Phase 9.
function setupStressHusbandry(deps: DebugPanelDeps): {
  chickens: number;
  cows: number;
  crates: number;
  feed: number;
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

  // Layout: 6×6 chicken pen left of camera, 6×6 cow pen right, crate
  // between them. The bigger pens give animals room to wander (each
  // tile holds at most one animal, but we deliberately leave most
  // tiles empty so the residents have somewhere to roam).
  const PEN_SIZE = 6;
  const ANIMALS_PER_PEN = 8;
  const chickenPenX = cx0 - 8; // top-left x of chicken 6×6
  const chickenPenY = cy0 - 3;
  const cowPenX = cx0 + 3; // top-left x of cow 6×6
  const cowPenY = cy0 - 3;
  const cratePos = { x: cx0, y: cy0 };

  // Floor the surrounding area in grass first so settlers can navigate
  // around the pens (pen tiles block walkability for settlers, but
  // animals walk freely between same-species pen tiles).
  for (let dy = -5; dy <= 5; dy++) {
    for (let dx = -12; dx <= 12; dx++) {
      writeTile(cx0 + dx, cy0 + dy, 10 /* dry_grass */);
    }
  }

  // Place pen tiles for both species.
  const chickenTiles: Array<{ x: number; y: number }> = [];
  const cowTiles: Array<{ x: number; y: number }> = [];
  for (let dy = 0; dy < PEN_SIZE; dy++) {
    for (let dx = 0; dx < PEN_SIZE; dx++) {
      const cwx = chickenPenX + dx;
      const cwy = chickenPenY + dy;
      if (writeTile(cwx, cwy, TILE_CHICKEN_PEN)) chickenTiles.push({ x: cwx, y: cwy });
      const xwx = cowPenX + dx;
      const xwy = cowPenY + dy;
      if (writeTile(xwx, xwy, TILE_COW_PEN)) cowTiles.push({ x: xwx, y: xwy });
    }
  }

  // Spawn the requested number of animals, skipping tiles in stride
  // so they start spread across the pen rather than packed in a corner.
  // Roaming logic does the rest at runtime.
  const spawnAt = (
    tile: { x: number; y: number },
    species: "chicken" | "cow",
  ): void => {
    const id = deps.entityManager.allocateId();
    const pos = {
      chunkX: Math.floor(tile.x / CHUNK_SIZE),
      chunkY: Math.floor(tile.y / CHUNK_SIZE),
      localX: ((tile.x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE + 0.5,
      localY: ((tile.y % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE + 0.5,
    };
    const animal =
      species === "chicken"
        ? new Chicken(id, pos, { x: tile.x, y: tile.y })
        : new Cow(id, pos, { x: tile.x, y: tile.y });
    deps.entityManager.add(animal);
  };

  let chickens = 0;
  let cows = 0;
  const chickenStride = Math.max(1, Math.floor(chickenTiles.length / ANIMALS_PER_PEN));
  for (let i = 0; i < ANIMALS_PER_PEN && i * chickenStride < chickenTiles.length; i++) {
    const t = chickenTiles[i * chickenStride];
    if (t) {
      spawnAt(t, "chicken");
      chickens++;
    }
  }
  const cowStride = Math.max(1, Math.floor(cowTiles.length / ANIMALS_PER_PEN));
  for (let i = 0; i < ANIMALS_PER_PEN && i * cowStride < cowTiles.length; i++) {
    const t = cowTiles[i * cowStride];
    if (t) {
      spawnAt(t, "cow");
      cows++;
    }
  }

  // Storage crate sits between the pens, pre-stocked with enough animal
  // feed to keep the loop running for several minutes of in-game time.
  let crates = 0;
  let feed = 0;
  if (writeTile(cratePos.x, cratePos.y, CRATE_TILE_ID)) {
    crates++;
    deps.crates.deposit(cratePos.x, cratePos.y, ITEM_IDS.ANIMAL_FEED, 200);
    feed = 200;
  }

  for (const key of dirty) {
    const [cx, cy] = key.split(",").map(Number) as [number, number];
    deps.chunkManager.markDirty(cx, cy, CHUNK_FLAG_DIRTY_RENDER | CHUNK_FLAG_DIRTY_SIMULATION);
  }
  return { chickens, cows, crates, feed };
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
    const picked = pickFullName(seed);
    const v = new Villager(
      id,
      {
        chunkX: Math.floor(wx / CHUNK_SIZE),
        chunkY: Math.floor(wy / CHUNK_SIZE),
        localX: ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE,
        localY: ((wy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE,
      },
      picked.name,
      { x: Math.floor(wx), y: Math.floor(wy) },
    );
    v.gender = picked.gender;
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
