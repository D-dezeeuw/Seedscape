// Building registry. Source of truth is data/buildings.json; this module
// mirrors only the fields Phase 4 actually consumes (mill + bakery), and adds
// the placement cost which is a Phase 4 introduction. Other buildings from
// the JSON stay deferred — see project_phase_deferred.md.
//
// Per docs/05_data_model.md, building tiles occupy IDs 200..299. Phase 4
// uses one tile per building (1×1 footprint). Tile encoding:
//   tileId   = building base id (200 = mill, 210 = bakery)
//   state    = cycleProgress in ticks (0..cycleTime)
//   metadata = queue count in bits 0..3 (max 15)
// Per-building input/output buffers aren't needed in Phase 4 — players "feed"
// raw items directly from inventory and outputs auto-deliver to inventory.

import { ITEM_IDS, type ItemId } from "../../state/items";

export const BUILDING_RANGE_MIN = 200;
export const BUILDING_RANGE_MAX = 299;

export const BUILDING_STATE_IDLE = 0;

export interface BuildingDef {
  id: number; // tile id, 200..299
  name: string;
  displayName: string;
  inputItem: ItemId;
  inputQuantity: number;
  outputItem: ItemId;
  outputQuantity: number;
  // Cycle time in simulation ticks. With the default 1 TPS this equals
  // seconds. Values mirror data/buildings.json entries.
  cycleTime: number;
  queueSize: number;
  // Coins to place. Mill is the gateway for the production chain so it's
  // priced to be reachable from a few NPC orders' worth of wheat.
  placementCost: number;
  unlockId: string; // matches state/unlocks.ts UnlockDef ids
  // Passive buildings (containers — crate, dispenser) have no sim cycle
  // and don't tick. The sim_pipeline branches off this flag so a
  // cycleTime=0 entry doesn't trigger an immediate "production complete"
  // event. The shop and placement code treat passive defs identically.
  passive?: boolean;
}

const PHASE_4_BUILDINGS: ReadonlyArray<BuildingDef> = [
  {
    id: 200,
    name: "mill",
    displayName: "Mill",
    inputItem: ITEM_IDS.WHEAT,
    inputQuantity: 3,
    outputItem: ITEM_IDS.FLOUR,
    outputQuantity: 2,
    cycleTime: 30,
    queueSize: 8,
    placementCost: 50,
    unlockId: "building.mill",
  },
  {
    id: 210,
    name: "bakery",
    displayName: "Bakery",
    // MVP recipe simplifies "2 flour + 1 egg" to "2 flour" because animals
    // are deferred — see project_phase_deferred.md (Phase 3.5 add-on).
    inputItem: ITEM_IDS.FLOUR,
    inputQuantity: 2,
    outputItem: ITEM_IDS.BREAD,
    outputQuantity: 3,
    cycleTime: 45,
    queueSize: 8,
    placementCost: 200,
    unlockId: "building.bakery",
  },
  // Passive containers — no sim cycle, contents tracked in CrateStore.
  // input/output fields are only filled to satisfy the type; sim_pipeline
  // skips passive defs so they're never read.
  {
    id: 220,
    name: "crate",
    displayName: "Storage Crate",
    inputItem: ITEM_IDS.WHEAT,
    inputQuantity: 0,
    outputItem: ITEM_IDS.WHEAT,
    outputQuantity: 0,
    cycleTime: 0,
    queueSize: 0,
    placementCost: 30,
    unlockId: "building.crate",
    passive: true,
  },
  {
    id: 221,
    name: "seed_dispenser",
    displayName: "Seed Dispenser",
    inputItem: ITEM_IDS.WHEAT_SEED,
    inputQuantity: 0,
    outputItem: ITEM_IDS.WHEAT_SEED,
    outputQuantity: 0,
    cycleTime: 0,
    queueSize: 0,
    placementCost: 60,
    unlockId: "building.seed_dispenser",
    passive: true,
  },
];

const BY_ID = new Map<number, BuildingDef>(PHASE_4_BUILDINGS.map((b) => [b.id, b]));

export function isBuildingTile(tileId: number): boolean {
  return tileId >= BUILDING_RANGE_MIN && tileId <= BUILDING_RANGE_MAX;
}

export function buildingForTile(tileId: number): BuildingDef | null {
  return BY_ID.get(tileId) ?? null;
}

export function listBuildings(): ReadonlyArray<BuildingDef> {
  return PHASE_4_BUILDINGS;
}

// Building metadata layout: queue count in low 4 bits.
const QUEUE_BITS_MASK = 0b1111;

export function getQueuedJobs(metadata: number): number {
  return metadata & QUEUE_BITS_MASK;
}

export function setQueuedJobs(metadata: number, count: number): number {
  const clamped = Math.max(0, Math.min(QUEUE_BITS_MASK, count));
  return (metadata & ~QUEUE_BITS_MASK) | clamped;
}
