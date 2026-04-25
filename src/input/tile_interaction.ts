// Wires pointer-up events on the canvas through pickTile + the active tool
// into the chunk's tile-action functions. Pointer drags are claimed by the
// camera controls; this fires only on a click that didn't move (no drag).
//
// XP rewards on harvest are wired here for completeness, even though the
// economy that consumes XP is Phase 4.

import type { Inventory } from "../state/inventory";
import { ITEM_IDS } from "../state/items";
import type { Player } from "../state/player";
import { CHUNK_FLAG_DIRTY_RENDER, CHUNK_FLAG_DIRTY_SIMULATION } from "../world/chunk";
import type { ChunkManager } from "../world/chunk_manager";
import { harvestTile, plantSeed, tillTile, waterTile } from "../world/farming/tile_actions";
import type { Camera } from "./camera";
import { pickTile } from "./picker";
import type { ToolState } from "./tool";

const HARVEST_XP_PER_YIELD = 1;
// A click is anything where the pointer moved less than this many pixels
// between down and up. Anything more is treated as a camera drag.
const CLICK_DRAG_TOLERANCE_PX = 4;

export interface TileInteractionDeps {
  canvas: HTMLCanvasElement;
  camera: Camera;
  tool: ToolState;
  inventory: Inventory;
  player: Player;
  chunkManager: ChunkManager;
  tileWorldSize: number;
  // Called whenever the player edits a tile so HUD/info panels can refresh.
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
        if (!inventory.has(ITEM_IDS.WHEAT_SEED, 1)) return;
        const result = plantSeed(record.data, pick.localX, pick.localY, ITEM_IDS.WHEAT_SEED);
        if (result.applied) {
          inventory.remove(ITEM_IDS.WHEAT_SEED, 1);
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
            player.xp = player.xp + result.yield * HARVEST_XP_PER_YIELD;
          }
          edited = true;
        }
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
