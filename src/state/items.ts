// Item ID catalog. Items are anything that can sit in the player inventory:
// seeds, harvested produce, processed goods, currency-shaped tokens. IDs share
// the same number space as tile IDs from data/tiles.json — seeds in 600..699
// (one slot per crop), produce in 700..799 (one slot per crop), processed
// goods in 800..899.
//
// data/crops.json reserves crop tile IDs at base + 0..7 stages: wheat 100,
// carrot 108, corn 116. Per-crop seed/produce ids derive from those bases:
// seed = 600 + (cropBase - 100), produce = 700 + (cropBase - 100). This keeps
// the math obvious for new crops without a separate translation table.

export const ITEM_IDS = {
  // Seeds (600-range)
  WHEAT_SEED: 600,
  CARROT_SEED: 608,
  CORN_SEED: 616,
  // Raw produce (700-range)
  WHEAT: 700,
  CARROT: 708,
  CORN: 716,
  // Processed goods (800-range)
  FLOUR: 800,
  BREAD: 810,
} as const;

export type ItemId = (typeof ITEM_IDS)[keyof typeof ITEM_IDS];

export interface ItemDef {
  id: ItemId;
  name: string;
  displayName: string;
  // Fixed sell price in coins. Phase 4 ships fixed prices only; dynamic
  // supply/demand math is deferred (see project_phase_deferred.md).
  basePrice: number;
}

const RAW: ReadonlyArray<ItemDef> = [
  { id: ITEM_IDS.WHEAT_SEED, name: "wheat_seed", displayName: "Wheat Seeds", basePrice: 1 },
  { id: ITEM_IDS.CARROT_SEED, name: "carrot_seed", displayName: "Carrot Seeds", basePrice: 2 },
  { id: ITEM_IDS.CORN_SEED, name: "corn_seed", displayName: "Corn Seeds", basePrice: 2 },
  { id: ITEM_IDS.WHEAT, name: "wheat", displayName: "Wheat", basePrice: 2 },
  { id: ITEM_IDS.CARROT, name: "carrot", displayName: "Carrot", basePrice: 5 },
  { id: ITEM_IDS.CORN, name: "corn", displayName: "Corn", basePrice: 4 },
  { id: ITEM_IDS.FLOUR, name: "flour", displayName: "Flour", basePrice: 12 },
  { id: ITEM_IDS.BREAD, name: "bread", displayName: "Bread", basePrice: 25 },
];

export const ITEM_DEFS: ReadonlyMap<ItemId, ItemDef> = new Map(RAW.map((def) => [def.id, def]));

export function getItemDef(id: ItemId): ItemDef {
  const def = ITEM_DEFS.get(id);
  if (!def) throw new Error(`unknown item id: ${id}`);
  return def;
}
