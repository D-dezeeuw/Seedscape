// Unlock tree. Each unlock is one of: a crop seed, a placeable building, or
// a feature. Unlocks have a required level; reaching that level grants them
// automatically. Phase 4 doesn't ship coin-cost activations or prerequisite
// chains — flat level-gating only. Per docs/12_progression_system.md.

export const UNLOCK_KIND = {
  SEED: "seed",
  BUILDING: "building",
} as const;

export type UnlockKind = (typeof UNLOCK_KIND)[keyof typeof UNLOCK_KIND];

export interface UnlockDef {
  id: string; // stable string key, used in save format
  kind: UnlockKind;
  // For SEED: the ItemId of the seed item. For BUILDING: the building id
  // (matches data/buildings.json id field). Stored as number so consumers
  // don't need to know what kind something is to look it up.
  targetId: number;
  requiredLevel: number;
  displayName: string;
}

// Phase 4 MVP unlock tree. Wheat is granted by default at level 1; carrot,
// corn, mill, bakery come online as the player levels up. Other entries
// from the roadmap (juicer, smelter, sprinkler, well) stay deferred — see
// project_phase_deferred.md.
export const UNLOCK_DEFS: ReadonlyArray<UnlockDef> = [
  { id: "seed.wheat", kind: "seed", targetId: 600, requiredLevel: 1, displayName: "Wheat seeds" },
  // Carrots unlock at level 1 alongside wheat — the fresh-world starter
  // inventory ships 4 carrot seeds (see STARTING_CARROT_SEEDS in main.ts)
  // so they have to be plantable from tick 0. Wheat stays available so
  // the bread chain (Mill / Bakery at higher levels) still has a path.
  {
    id: "seed.carrot",
    kind: "seed",
    targetId: 608,
    requiredLevel: 1,
    displayName: "Carrot seeds",
  },
  // Crate + dispenser unlock at level 2 — early enough that settler
  // autonomy (Phase 7) is reachable on the first farm before the player
  // touches the production chain. Cheaper than the mill so the cost
  // curve still introduces them gradually.
  {
    id: "building.crate",
    kind: "building",
    targetId: 220,
    requiredLevel: 2,
    displayName: "Storage Crate",
  },
  {
    id: "building.seed_dispenser",
    kind: "building",
    targetId: 221,
    requiredLevel: 2,
    displayName: "Seed Dispenser",
  },
  { id: "building.mill", kind: "building", targetId: 200, requiredLevel: 3, displayName: "Mill" },
  {
    id: "building.bakery",
    kind: "building",
    targetId: 210,
    requiredLevel: 5,
    displayName: "Bakery",
  },
  { id: "seed.corn", kind: "seed", targetId: 616, requiredLevel: 7, displayName: "Corn seeds" },
  // Phase 9 unlocks — irrigation + animals slot in around the mill/carrot
  // tier so a player can bring them online before tackling the production
  // chain at higher levels.
  { id: "building.well", kind: "building", targetId: 230, requiredLevel: 4, displayName: "Well" },
  {
    id: "building.chicken_pen",
    kind: "building",
    targetId: 400,
    requiredLevel: 4,
    displayName: "Chicken Pen",
  },
  {
    id: "building.sprinkler",
    kind: "building",
    targetId: 231,
    requiredLevel: 6,
    displayName: "Sprinkler",
  },
  {
    id: "building.cow_pen",
    kind: "building",
    targetId: 410,
    requiredLevel: 6,
    displayName: "Cow Pen",
  },
];

// Debug override: when true, every unlock check returns true regardless
// of player level. Set via setDebugUnlockAll() from the debug panel.
// Module-local so the override is process-scoped (not per-call), and
// not persisted in saves — toggling resets on reload, which is the
// behavior we want for a developer flag. Production builds tree-shake
// the debug panel that flips it, so the flag stays false in releases.
let debugUnlockAll = false;

export function setDebugUnlockAll(value: boolean): void {
  debugUnlockAll = value;
}

export function isDebugUnlockAll(): boolean {
  return debugUnlockAll;
}

// Returns the set of unlock ids the player should currently have, given a
// level. This is computed from level rather than persisted as a list because
// it's small and avoids one more piece of state to keep in sync.
export function unlocksForLevel(level: number): Set<string> {
  const out = new Set<string>();
  if (debugUnlockAll) {
    // Debug override grants every unlock id regardless of level so any
    // UI that consumes the set (level-up notifications, shop filters)
    // stays consistent with the gate functions below.
    for (const def of UNLOCK_DEFS) out.add(def.id);
    return out;
  }
  for (const def of UNLOCK_DEFS) {
    if (level >= def.requiredLevel) out.add(def.id);
  }
  return out;
}

export function getUnlockDef(id: string): UnlockDef | null {
  return UNLOCK_DEFS.find((def) => def.id === id) ?? null;
}

// Find unlocks that are newly available at `level` but weren't at `level-1`.
// Used by the level-up notification.
export function newUnlocksAtLevel(level: number): UnlockDef[] {
  return UNLOCK_DEFS.filter((def) => def.requiredLevel === level);
}

export function isBuildingUnlocked(level: number, buildingId: number): boolean {
  if (debugUnlockAll) return hasUnlockTarget(buildingId, "building");
  for (const def of UNLOCK_DEFS) {
    if (def.kind !== "building") continue;
    if (def.targetId !== buildingId) continue;
    return level >= def.requiredLevel;
  }
  return false;
}

export function isSeedUnlocked(level: number, seedId: number): boolean {
  if (debugUnlockAll) return hasUnlockTarget(seedId, "seed");
  for (const def of UNLOCK_DEFS) {
    if (def.kind !== "seed") continue;
    if (def.targetId !== seedId) continue;
    return level >= def.requiredLevel;
  }
  return false;
}

// Debug-override helper: returns true iff the registry actually defines
// an unlock for this (kind, id) pair. The override grants ALL real
// unlocks, but unknown ids still return false — matches the current
// non-debug semantics (which also return false for unknown ids).
function hasUnlockTarget(targetId: number, kind: UnlockKind): boolean {
  for (const def of UNLOCK_DEFS) {
    if (def.kind === kind && def.targetId === targetId) return true;
  }
  return false;
}
