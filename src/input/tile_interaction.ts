// Wires pointer-up events on the canvas through pickTile + the active tool
// into the chunk's tile-action functions. Pointer drags are claimed by the
// camera controls; this fires only on a click that didn't move (no drag).

import type { Entity } from "../state/entities/entity";
import type { EntityManager } from "../state/entities/entity_manager";
import type { Inventory } from "../state/inventory";
import { ITEM_IDS, type ItemId } from "../state/items";
import type { Player } from "../state/player";
import { isSeedUnlocked } from "../state/unlocks";
import { CHUNK_FLAG_DIRTY_RENDER, CHUNK_FLAG_DIRTY_SIMULATION } from "../world/chunk";
import type { ChunkManager } from "../world/chunk_manager";
import { dismantleBuilding, enqueueJob, setBuildingTile } from "../world/farming/building_actions";
import { buildingForTile } from "../world/farming/building_registry";
import { cropForSeed } from "../world/farming/crop_registry";
import { penForTile, setPenTile } from "../world/farming/pen_registry";
import { harvestTile, plantSeed, tillTile, waterTile } from "../world/farming/tile_actions";
import type { Camera } from "./camera";
import { type PickResult, pickTile } from "./picker";
import type { ToolState } from "./tool";

const HARVEST_XP_PER_YIELD = 1;
const PRODUCTION_FEED_XP = 2;
const CLICK_DRAG_TOLERANCE_PX = 4;

// Default seed for the plant tool when the player has multiple seed types.
// Phase 4 picks the first seed in inventory in priority order. Replaced when
// the UI grows a seed selector.
const SEED_PRIORITY: ItemId[] = [ITEM_IDS.WHEAT_SEED, ITEM_IDS.CARROT_SEED, ITEM_IDS.CORN_SEED];

function pickPlantSeed(
  inventory: Inventory,
  playerLevel: number,
  preferred: ItemId | null,
): ItemId | null {
  // Honour the player's explicit selection from the seed-row UI when the
  // pick is still valid (unlocked + in inventory). Falls back to the
  // priority list so a stale or empty selection still does something
  // sensible instead of silently no-op'ing.
  if (preferred !== null && isSeedUnlocked(playerLevel, preferred) && inventory.has(preferred, 1)) {
    return preferred;
  }
  for (const seed of SEED_PRIORITY) {
    if (!isSeedUnlocked(playerLevel, seed)) continue;
    if (inventory.has(seed, 1)) return seed;
  }
  return null;
}

// Inputs for applyToolAt. Same surface as the click handler used to read
// directly off TileInteractionDeps; pulling them into a parameter object
// lets the action-key path reuse the exact same tool logic.
export interface ToolApplyDeps {
  tool: ToolState;
  inventory: Inventory;
  player: Player;
  chunkManager: ChunkManager;
  onEdit?: (chunkX: number, chunkY: number) => void;
}

// Runs the currently-selected tool against the given tile. Returns true
// if the world changed (chunk dirty flags + onEdit fire). No-op when the
// chunk isn't loaded yet, or the tool's preconditions fail (no seed, no
// coins, target tile wrong type, etc.) — same rules as click input.
export function applyToolAt(deps: ToolApplyDeps, pick: PickResult): boolean {
  const record = deps.chunkManager.peekChunk(pick.chunkX, pick.chunkY);
  if (!record) return false;

  let edited = false;
  switch (deps.tool.current) {
    case "till": {
      edited = tillTile(record.data, pick.localX, pick.localY).applied;
      break;
    }
    case "plant": {
      const seed = pickPlantSeed(deps.inventory, deps.player.level, deps.tool.selectedSeedId);
      if (!seed) return false;
      const def = cropForSeed(seed);
      if (!def) return false;
      const result = plantSeed(record.data, pick.localX, pick.localY, seed);
      if (result.applied) {
        deps.inventory.remove(seed, 1);
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
          deps.inventory.add(result.produceItem, result.yield);
          deps.player.addXp(result.yield * HARVEST_XP_PER_YIELD);
        }
        // Phase 10.1: every harvest drops a small random seed bundle
        // so the farm can sustain itself without buying every cycle.
        if (result.seedItem && result.seedYield) {
          deps.inventory.add(result.seedItem, result.seedYield);
        }
        edited = true;
      }
      break;
    }
    case "build": {
      const placeId = deps.tool.selectedBuildingId;
      if (placeId == null) return false;
      // The build tool is shared by buildings (200-299) and animal pens
      // (400-499) — same UX flow, same placement cost mechanic, just two
      // different registries.
      const buildingDef = buildingForTile(placeId);
      const penDef = buildingDef ? null : penForTile(placeId);
      if (!buildingDef && !penDef) return false;
      const cost = buildingDef?.placementCost ?? penDef?.placementCost ?? 0;
      if (!deps.player.spendCoins(cost)) return false;
      let placed = false;
      if (buildingDef) {
        placed = setBuildingTile(record.data, pick.localX, pick.localY, buildingDef).applied;
      } else if (penDef) {
        placed = setPenTile(record.data, pick.localX, pick.localY, penDef);
      }
      if (!placed) {
        deps.player.addCoins(cost);
        return false;
      }
      edited = true;
      break;
    }
    case "feed": {
      const i = pick.localY * 32 + pick.localX;
      const tileId = record.data.tileId[i] ?? 0;
      const def = buildingForTile(tileId);
      if (!def) return false;
      if (!deps.inventory.has(def.inputItem, def.inputQuantity)) return false;
      const result = enqueueJob(record.data, pick.localX, pick.localY);
      if (result.applied) {
        deps.inventory.remove(def.inputItem, def.inputQuantity);
        deps.player.addXp(PRODUCTION_FEED_XP);
        edited = true;
      }
      break;
    }
    case "dismantle": {
      edited = dismantleBuilding(record.data, pick.localX, pick.localY).applied;
      break;
    }
    default:
      return false;
  }

  if (edited) {
    // Route through markDirty so the chunk-mutated hook fires —
    // pathfinding mirrors get refreshed (settlers must route around
    // newly-placed buildings / pens) and the autosave's dirty-set
    // grows. Direct flag mutation skipped both, which silently lost
    // pens to a quick reload before the next 30s autosave window.
    deps.chunkManager.markDirty(
      pick.chunkX,
      pick.chunkY,
      CHUNK_FLAG_DIRTY_RENDER | CHUNK_FLAG_DIRTY_SIMULATION,
    );
    deps.onEdit?.(pick.chunkX, pick.chunkY);
  }
  return edited;
}

export interface TileInteractionDeps {
  canvas: HTMLCanvasElement;
  camera: Camera;
  tool: ToolState;
  inventory: Inventory;
  player: Player;
  chunkManager: ChunkManager;
  tileWorldSize: number;
  // Pan-mode (tool === "none") clicks first try to hit an entity. When
  // an entity is hit, onEntityClick fires and the click is consumed —
  // no tile action runs.
  entityManager?: EntityManager;
  onEntityClick?: (entity: Entity) => void;
  onEdit?: (chunkX: number, chunkY: number) => void;
  // Returns true while the player is possessing an avatar. In that mode
  // canvas clicks must NOT trigger tile actions — actions come from the
  // avatar via the action key. Drag-pan and click-to-pick-entity remain
  // available so the player can still peek and switch possession target.
  isPossessing?: () => boolean;
  // Pan-mode click on a container tile (crate, dispenser) — fires AFTER
  // the entity-picker check fails, so clicking on a settler standing on
  // a crate still opens the person window. Possessing blocks this too,
  // matching the rule that god-mode tools don't fire when possessed.
  onContainerClick?: (worldTileX: number, worldTileY: number) => void;
  // Pan-mode click on an active building tile (Mill, Bakery in Phase 8).
  // Same gating as onContainerClick; the handler self-checks the tile
  // type so it's safe to fire alongside onContainerClick.
  onBuildingClick?: (worldTileX: number, worldTileY: number) => void;
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

    // Pan-mode (tool === "none") OR possess-mode: clicks pick an entity
    // and never fire tile actions. Possess-mode actions come from the
    // avatar via the action key; clicking the world while possessed must
    // not act, but clicking another villager to switch the selection
    // (and re-target possession) is still useful so we keep the picker.
    if (tool.current === "none" || deps.isPossessing?.()) {
      if (deps.entityManager && deps.onEntityClick) {
        const worldX = pick.worldTileX + 0.5;
        const worldY = pick.worldTileY + 0.5;
        const e = deps.entityManager.pickAt(worldX, worldY, 0.6);
        if (e) {
          deps.onEntityClick(e);
          return;
        }
      }
      // No entity hit: pan-mode (only) opens the container or building
      // window when the click lands on a matching tile. Possessing skips
      // this — the possessed avatar uses the action key for tile actions.
      if (tool.current === "none" && !deps.isPossessing?.()) {
        // Both callbacks self-check the tile type and bail when it
        // doesn't match (containers are passive defs, buildings are
        // active defs), so calling them in sequence is safe — only the
        // matching one will actually open a window.
        deps.onContainerClick?.(pick.worldTileX, pick.worldTileY);
        deps.onBuildingClick?.(pick.worldTileX, pick.worldTileY);
      }
      return;
    }

    applyToolAt(
      {
        tool,
        inventory,
        player,
        chunkManager,
        ...(deps.onEdit ? { onEdit: deps.onEdit } : {}),
      },
      pick,
    );
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
