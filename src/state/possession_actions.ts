// Pure context → action resolver for the possessed-avatar action bar.
//
// When the player possesses a Villager, "press E" no longer means "run
// the toolbar's selected tool". It means "do the contextual thing for
// the tile in front of me, given what I'm carrying". This module is the
// single source of truth for what that contextual thing is.
//
// Pure function: same (faced tile, settler state, world snapshot) →
// same PossessedAction. No DOM, no input, no side effects. The action
// bar UI calls resolvePossessedAction every frame for display; the
// action key calls executePossessedAction once per press.

import { buildingForTile } from "../world/farming/building_registry";
import { containerForTile, isSeedItem } from "../world/farming/container_registry";
import { CROP_STAGE_HARVESTABLE, CROP_STATE_WILTED, cropForTile } from "../world/farming/crop_registry";
import { getWaterLevel } from "../world/farming/tile_actions";
import { isWaterSource } from "../world/walkability";
import type { EntityServices } from "./entities/entity";
import { MAX_WATER_RESERVE, type Villager } from "./entities/villager";
import type { ItemId } from "./items";

const TILE_DRY_GRASS = 10;
const TILE_RICH_SOIL = 11;
const TILE_FARMLAND_TILLED = 13;
// Threshold mirrors job_emitter.WATER_THIRSTY_THRESHOLD — we don't import
// it to avoid a UI-layer dependency on the emitter. Keep in sync.
const WATER_THIRSTY_THRESHOLD = 1;

// Tile snapshot the resolver consumes. Keeping the input shape narrow
// (3 numbers + coords) makes tests trivial — no need to construct a
// fake TileWorldAccess or chunk record.
export interface ResolverTile {
  x: number;
  y: number;
  tileId: number;
  state: number;
  metadata: number;
}

// Discriminated union of every possible action the contextual bar can
// surface. `kind: "none"` is the inactive / empty case. `kind:
// "blocked"` is "would be valid but a precondition fails" — surfaced
// as a muted "Need water" / "Need seed" hint instead of an active
// button. The bar UI renders each case differently.
export type PossessedAction =
  | { kind: "open_container"; container: { x: number; y: number }; label: string }
  | { kind: "open_building"; building: { x: number; y: number }; label: string }
  | { kind: "haul_water"; source: { x: number; y: number } }
  | { kind: "water_crop"; tile: { x: number; y: number } }
  | { kind: "harvest_crop"; tile: { x: number; y: number } }
  | { kind: "plant_seed"; tile: { x: number; y: number }; seedId: ItemId }
  | { kind: "till"; tile: { x: number; y: number } }
  | { kind: "blocked"; reason: "need_water" | "need_seed" }
  | { kind: "none" };

export function resolvePossessedAction(
  villager: Villager,
  tile: ResolverTile | null,
  _services: EntityServices,
): PossessedAction {
  if (!tile) return { kind: "none" };

  // 1. Containers (crate, dispenser) — open the transfer window.
  const containerDef = containerForTile(tile.tileId);
  if (containerDef) {
    return {
      kind: "open_container",
      container: { x: tile.x, y: tile.y },
      label: containerLabel(tile.tileId),
    };
  }

  // 2. Active buildings (Mill, Bakery) — open the building window.
  // Passive containers were already returned above.
  const buildingDef = buildingForTile(tile.tileId);
  if (buildingDef && !buildingDef.passive) {
    return {
      kind: "open_building",
      building: { x: tile.x, y: tile.y },
      label: buildingDef.displayName,
    };
  }

  // 3. Water source — fill reserve. Skip when already full so the bar
  // doesn't promise a no-op action.
  if (isWaterSource(tile.tileId) && villager.waterReserve < MAX_WATER_RESERVE) {
    return { kind: "haul_water", source: { x: tile.x, y: tile.y } };
  }

  // 4. Crop tile — branch on stage.
  const crop = cropForTile(tile.tileId);
  if (crop) {
    if (tile.state === CROP_STATE_WILTED) return { kind: "none" };
    if (tile.state >= CROP_STAGE_HARVESTABLE) {
      return { kind: "harvest_crop", tile: { x: tile.x, y: tile.y } };
    }
    // Growing crop. If the tile is thirsty AND settler has reserve →
    // water it. Otherwise muted "Need water" hint.
    const water = getWaterLevel(tile.metadata);
    if (water <= WATER_THIRSTY_THRESHOLD) {
      if (villager.waterReserve > 0) {
        return { kind: "water_crop", tile: { x: tile.x, y: tile.y } };
      }
      return { kind: "blocked", reason: "need_water" };
    }
    // Healthy growing crop — nothing to do here.
    return { kind: "none" };
  }

  // 5. Empty tilled farmland — plant if settler is carrying a seed.
  if (tile.tileId === TILE_FARMLAND_TILLED && tile.state === 0) {
    const seedId = carriedSeedId(villager);
    if (seedId !== null) {
      return { kind: "plant_seed", tile: { x: tile.x, y: tile.y }, seedId };
    }
    return { kind: "blocked", reason: "need_seed" };
  }

  // 6. Tillable soil. Dry grass and rich soil both till to farmland in
  // tile_actions.tillTile. Other ground types fall through to none.
  if (tile.tileId === TILE_DRY_GRASS || tile.tileId === TILE_RICH_SOIL) {
    return { kind: "till", tile: { x: tile.x, y: tile.y } };
  }

  return { kind: "none" };
}

// True when the resolved action represents an immediate, executable
// thing (vs `none` or `blocked`). The UI uses this to decide whether
// to highlight the faced-tile in active yellow or muted grey.
export function isActionable(action: PossessedAction): boolean {
  return action.kind !== "none" && action.kind !== "blocked";
}

// Find the first seed kind the settler is carrying. Mirrors the helper
// in villager_jobs.ts (which is private to that module). Used here for
// the plant-seed action — picks whatever the settler picked up most
// recently (Map iteration order = insertion order, deterministic).
function carriedSeedId(v: Villager): ItemId | null {
  for (const [item] of v.carriedItems) {
    if (isSeedItem(item)) return item;
  }
  return null;
}

// Display name for a container tile. Two containers exist today; the
// list grows in lockstep with container_registry. Keeping the lookup
// inline rather than re-walking the registry keeps the bar render
// allocation-free.
function containerLabel(tileId: number): string {
  if (tileId === 220) return "Storage Crate";
  if (tileId === 221) return "Seed Dispenser";
  return "Container";
}
