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
import {
  CROP_STAGE_HARVESTABLE,
  CROP_STATE_WILTED,
  cropForTile,
} from "../world/farming/crop_registry";
import { getWaterLevel } from "../world/farming/tile_actions";
import { isWaterSource } from "../world/walkability";
import type { EntityServices } from "./entities/entity";
import { MEMORY_EVENT_TYPES, recordMemory } from "./entities/living_entity";
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

// Side-effecting executor — runs the resolved action's world mutation.
// Returns one of: "ok" (mutation landed), "noop" (nothing to do — e.g.
// the action was `none` or `blocked`), or "container" / "building"
// (caller should open the matching window — those don't mutate the
// world directly). Lives next to the resolver so the two are
// trivially in sync; tests can drive the dispatch via a mock services.
//
// Memory events are recorded so possessed actions show up in the
// Person window's history alongside autonomous ones — the player's
// turn at the wheel still counts as "the settler did this thing".
export type ActionExecutionResult =
  | { kind: "ok" }
  | { kind: "noop" }
  | { kind: "open_container"; container: { x: number; y: number } }
  | { kind: "open_building"; building: { x: number; y: number } };

export function executePossessedAction(
  villager: Villager,
  action: PossessedAction,
  services: EntityServices,
  simTick: number,
): ActionExecutionResult {
  const tw = services.tileWorld;
  switch (action.kind) {
    case "open_container":
      return { kind: "open_container", container: action.container };
    case "open_building":
      return { kind: "open_building", building: action.building };
    case "haul_water": {
      // Possessed equivalent of the HAUL_WATER job's actAtSource. We
      // already verified the faced tile is a water source in the
      // resolver; just refill the reserve.
      villager.waterReserve = MAX_WATER_RESERVE;
      recordMemoryHere(villager, "HAULED_WATER", 0, action.source, simTick);
      return { kind: "ok" };
    }
    case "water_crop": {
      if (!tw) return { kind: "noop" };
      if (villager.waterReserve <= 0) return { kind: "noop" };
      const applied = tw.waterAt(action.tile.x, action.tile.y);
      if (!applied) return { kind: "noop" };
      villager.waterReserve--;
      const t = tw.readTile(action.tile.x, action.tile.y);
      const crop = t ? cropForTile(t.tileId) : null;
      recordMemoryHere(villager, "WATERED", crop?.produceItem ?? 0, action.tile, simTick);
      return { kind: "ok" };
    }
    case "harvest_crop": {
      if (!tw) return { kind: "noop" };
      const result = tw.harvestAt(action.tile.x, action.tile.y);
      if (!result.applied) return { kind: "noop" };
      if (result.produceItem != null && result.yield != null) {
        villager.pickup(result.produceItem as ItemId, result.yield);
        recordMemoryHere(villager, "HARVESTED", result.produceItem, action.tile, simTick);
      }
      return { kind: "ok" };
    }
    case "plant_seed": {
      if (!tw) return { kind: "noop" };
      // Burn one seed from carry; if the plant call fails (someone
      // beat us to it), refund.
      const dropped = villager.drop(action.seedId, 1);
      if (dropped === 0) return { kind: "noop" };
      const planted = tw.plantSeedAt(action.tile.x, action.tile.y, action.seedId);
      if (!planted) {
        villager.pickup(action.seedId, dropped);
        return { kind: "noop" };
      }
      recordMemoryHere(villager, "PLANTED", action.seedId, action.tile, simTick);
      return { kind: "ok" };
    }
    case "till": {
      if (!tw) return { kind: "noop" };
      const applied = tw.tillAt(action.tile.x, action.tile.y);
      return applied ? { kind: "ok" } : { kind: "noop" };
    }
    case "blocked":
    case "none":
      return { kind: "noop" };
  }
}

// Stamp a memory ring-buffer entry for an action the possessed
// settler just performed. Same shape as the autonomous job paths
// use, so the Person window's history doesn't distinguish between
// "settler did this on its own" and "player drove this".
type MemoryKind =
  | "HARVESTED"
  | "PLANTED"
  | "WATERED"
  | "HAULED_WATER"
  | "HAULED_SEED"
  | "DEPOSITED";
function recordMemoryHere(
  v: Villager,
  kind: MemoryKind,
  subjectId: number,
  pos: { x: number; y: number },
  simTick: number,
): void {
  recordMemory(v, {
    type: MEMORY_EVENT_TYPES[kind],
    tick: simTick,
    subjectId,
    tileX: pos.x,
    tileY: pos.y,
  });
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
