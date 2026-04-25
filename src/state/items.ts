// Item ID catalog. Items are anything that can sit in the player inventory:
// seeds, harvested produce, currency-shaped tokens. IDs share the same number
// space as tile IDs from data/tiles.json (seeds + produce live above the tile
// reserved range, in 600+).

export const ITEM_IDS = {
  WHEAT_SEED: 600,
  WHEAT: 700,
} as const;

export type ItemId = (typeof ITEM_IDS)[keyof typeof ITEM_IDS];

export interface ItemDef {
  id: ItemId;
  name: string;
  displayName: string;
}

export const ITEM_DEFS: ReadonlyMap<ItemId, ItemDef> = new Map([
  [
    ITEM_IDS.WHEAT_SEED,
    { id: ITEM_IDS.WHEAT_SEED, name: "wheat_seed", displayName: "Wheat Seeds" },
  ],
  [ITEM_IDS.WHEAT, { id: ITEM_IDS.WHEAT, name: "wheat", displayName: "Wheat" }],
]);

export function getItemDef(id: ItemId): ItemDef {
  const def = ITEM_DEFS.get(id);
  if (!def) throw new Error(`unknown item id: ${id}`);
  return def;
}
