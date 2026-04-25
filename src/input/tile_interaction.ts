// Wires pointer-up events on the canvas through pickTile + the active tool
// into the chunk's tile-action functions. Pointer drags are claimed by the
// camera controls; this fires only on a click that didn't move (no drag).

import type { Inventory } from "../state/inventory";
import { ITEM_IDS, type ItemId } from "../state/items";
import type { Player } from "../state/player";
import { isSeedUnlocked } from "../state/unlocks";
import { CHUNK_FLAG_DIRTY_RENDER, CHUNK_FLAG_DIRTY_SIMULATION } from "../world/chunk";
import type { ChunkManager } from "../world/chunk_manager";
import { dismantleBuilding, enqueueJob, setBuildingTile } from "../world/farming/building_actions";
import { buildingForTile } from "../world/farming/building_registry";
import { cropForSeed } from "../world/farming/crop_registry";
import { harvestTile, plantSeed, tillTile, waterTile } from "../world/farming/tile_actions";
import type { Camera } from "./camera";
import { pickTile } from "./picker";
import type { ToolState } from "./tool";

const HARVEST_XP_PER_YIELD = 1;
const PRODUCTION_FEED_XP = 2;
const CLICK_DRAG_TOLERANCE_PX = 4;

// Default seed for the plant tool when the player has multiple seed types.
// Phase 4 picks the first seed in inventory in priority order. Replaced when
// the UI grows a seed selector.
const SEED_PRIORITY: ItemId[] = [ITEM_IDS.WHEAT_SEED, ITEM_IDS.CARROT_SEED, ITEM_IDS.CORN_SEED];

function pickPlantSeed(inventory: Inventory, playerLevel: number): ItemId | null {
  for (const seed of SEED_PRIORITY) {
    if (!isSeedUnlocked(playerLevel, seed)) continue;
    if (inventory.has(seed, 1)) return seed;
  }
  return null;
}

export interface TileInteractionDeps {
  canvas: HTMLCanvasElement;
  camera: Camera;
  tool: ToolState;
  inventory: Inventory;
  player: Player;
  chunkManager: ChunkManager;
  tileWorldSize: number;
  onEdit?: (chunkX: number, chunkY: number) => void;
}

export function attachTileInteraction(deps: TileInteractionDeps): () => void {
  const { canvas, camera, tool, inventory, player, chunkManager, tileWorldSize } = deps;

  let downX = 0;
  let downY = 0;
  let pointerActive = false;

  const onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    downX = e.clientX;
    downY = e.clientY;
    pointerActive = true;
  };

  const onPointerUp = (e: PointerEvent): void => {
    if (e.button !== 0 || !pointerActive) return;
    pointerActive = false;
    const dx = Math.abs(e.clientX - downX);
    const dy = Math.abs(e.clientY - downY);
    if (dx > CLICK_DRAG_TOLERANCE_PX || dy > CLICK_DRAG_TOLERANCE_PX) return;
    if (tool.current === "none") return;

    const rect = canvas.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;
    const pick = pickTile(
      localX,
      localY,
      canvas.clientWidth,
      canvas.clientHeight,
      camera.x,
      camera.y,
      camera.zoom,
      tileWorldSize,
    );

    const record = chunkManager.peekChunk(pick.chunkX, pick.chunkY);
    if (!record) return; // chunk hasn't been generated yet

    let edited = false;
    switch (tool.current) {
      case "till": {
        edited = tillTile(record.data, pick.localX, pick.localY).applied;
        break;
      }
      case "plant": {
        const seed = pickPlantSeed(inventory, player.level);
        if (!seed) return;
        const def = cropForSeed(seed);
        if (!def) return;
        const result = plantSeed(record.data, pick.localX, pick.localY, seed);
        if (result.applied) {
          inventory.remove(seed, 1);
          edited = true;
        }
        break;
      }
      case "water": {
        edited = waterTile(record.data, pick.localX, pick.localY).applied;
        break;
      }
      case "harvest": {
        const result = harvestTile(record.data, pick.localX, pick.localY);
        if (result.applied) {
          if (result.yield && result.produceItem) {
            inventory.add(result.produceItem, result.yield);
            player.addXp(result.yield * HARVEST_XP_PER_YIELD);
          }
          edited = true;
        }
        break;
      }
      case "build": {
        const buildingId = tool.selectedBuildingId;
        if (buildingId == null) return;
        const def = buildingForTile(buildingId);
        if (!def) return;
        if (!player.spendCoins(def.placementCost)) return;
        const result = setBuildingTile(record.data, pick.localX, pick.localY, def);
        if (!result.applied) {
          // Refund — the player paid but the placement target was wrong.
          player.addCoins(def.placementCost);
          return;
        }
        edited = true;
        // Stay in build mode; the user can place multiple of the same kind
        // until they switch tools or pick a different one in the shop.
        break;
      }
      case "feed": {
        const i = pick.localY * 32 + pick.localX;
        const tileId = record.data.tileId[i] ?? 0;
        const def = buildingForTile(tileId);
        if (!def) return;
        if (!inventory.has(def.inputItem, def.inputQuantity)) return;
        const result = enqueueJob(record.data, pick.localX, pick.localY);
        if (result.applied) {
          inventory.remove(def.inputItem, def.inputQuantity);
          player.addXp(PRODUCTION_FEED_XP);
          edited = true;
        }
        break;
      }
      case "dismantle": {
        edited = dismantleBuilding(record.data, pick.localX, pick.localY).applied;
        break;
      }
      default:
        return;
    }

    if (edited) {
      record.flags |= CHUNK_FLAG_DIRTY_RENDER | CHUNK_FLAG_DIRTY_SIMULATION;
      deps.onEdit?.(pick.chunkX, pick.chunkY);
    }
  };

  const onPointerCancel = (): void => {
    pointerActive = false;
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);

  return () => {
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerCancel);
  };
}
