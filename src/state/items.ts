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
  // Animal products (Phase 9). Eggs + milk live in the produce range
  // because they're collected raw and behave like crops downstream:
  // sellable at the trader, edible by future cooking, hauled by the
  // same COLLECT_PRODUCE job.
  EGG: 710,
  MILK: 711,
  // Animal feed (Phase 9). Bought at the shop until the Feed Press
  // ships in Phase 11; consumed by pens to refill animal hunger.
  ANIMAL_FEED: 720,
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
  // Weight per unit in deci-units (×10). Stored as an integer so all
  // carry-capacity math stays in integer arithmetic — no float drift
  // when summing across heterogeneous inventories. Display layers can
  // divide by 10 to render kilograms/pounds. Settlers compare a
  // running sum against their per-class cap (see LivingEntity.maxCarryWeight).
  weight: number;
  // Auto-deposit exempt: when true, settlers never auto-dump this item
  // even when overweight. Used for items that are tiny and always
  // useful for an upcoming job (seeds → PLANT_SEED). Job.holdItems on
  // a per-job basis layers on top — a future haul job can declare a
  // non-default-sticky item (e.g. flour) as held for the trip.
  defaultSticky?: boolean;
  // Hunger restored per unit eaten, in 0..255 byte-of-need units. 0 or
  // missing = not edible (raw materials like wheat / flour). Settlers
  // pull eligible items from any crate when their hunger drops below
  // HUNGER_HUNGRY_THRESHOLD; the item is consumed and hunger raised
  // by foodValue, clamped to HUNGER_MAX.
  foodValue?: number;
}

const RAW: ReadonlyArray<ItemDef> = [
  // Seeds are pocket-light: a settler can hold dozens before the cap matters.
  // Marked sticky so they're never auto-deposited — the next PLANT_SEED job
  // is more useful than a tidy crate.
  {
    id: ITEM_IDS.WHEAT_SEED,
    name: "wheat_seed",
    displayName: "Wheat Seeds",
    basePrice: 1,
    weight: 1,
    defaultSticky: true,
  },
  {
    id: ITEM_IDS.CARROT_SEED,
    name: "carrot_seed",
    displayName: "Carrot Seeds",
    basePrice: 2,
    weight: 1,
    defaultSticky: true,
  },
  {
    id: ITEM_IDS.CORN_SEED,
    name: "corn_seed",
    displayName: "Corn Seeds",
    basePrice: 2,
    weight: 1,
    defaultSticky: true,
  },
  // Raw produce is the bulk of farm hauling; bands chosen so a default
  // cap of 100 maps to "≈10 wheat / 8 corn / 12 carrots" — enough for one
  // round trip per harvest. Carrots and corn are edible directly;
  // wheat is a raw grain that needs the Mill before it counts as food.
  { id: ITEM_IDS.WHEAT, name: "wheat", displayName: "Wheat", basePrice: 2, weight: 10 },
  {
    id: ITEM_IDS.CARROT,
    name: "carrot",
    displayName: "Carrot",
    basePrice: 5,
    weight: 8,
    foodValue: 60,
  },
  {
    id: ITEM_IDS.CORN,
    name: "corn",
    displayName: "Corn",
    basePrice: 4,
    weight: 12,
    foodValue: 70,
  },
  // Flour is sack-heavy on purpose so the mill→bakery haul (Phase 8)
  // feels like real labour. Bread is light enough that a settler can
  // run a stack — and very filling, the highest-foodValue item the
  // village can produce in Phase 10.1.
  { id: ITEM_IDS.FLOUR, name: "flour", displayName: "Flour", basePrice: 12, weight: 25 },
  {
    id: ITEM_IDS.BREAD,
    name: "bread",
    displayName: "Bread",
    basePrice: 25,
    weight: 6,
    foodValue: 120,
  },
  // Phase 9 animal products. Eggs are pocket-light + edible directly,
  // but less filling than vegetables. Milk is an ingredient (cheese
  // / butter in Phase 11) — not eaten directly.
  {
    id: ITEM_IDS.EGG,
    name: "egg",
    displayName: "Egg",
    basePrice: 4,
    weight: 4,
    foodValue: 40,
  },
  { id: ITEM_IDS.MILK, name: "milk", displayName: "Milk", basePrice: 8, weight: 15 },
  // Animal feed: cheap and lightweight. Bought from the shop until a
  // Feed Press ships in Phase 11.
  {
    id: ITEM_IDS.ANIMAL_FEED,
    name: "animal_feed",
    displayName: "Animal Feed",
    basePrice: 1,
    weight: 5,
  },
];

export const ITEM_DEFS: ReadonlyMap<ItemId, ItemDef> = new Map(RAW.map((def) => [def.id, def]));

export function getItemDef(id: ItemId): ItemDef {
  const def = ITEM_DEFS.get(id);
  if (!def) throw new Error(`unknown item id: ${id}`);
  return def;
}

// Lookup helper. Items not in the registry weigh 0 so unknown ids never
// throw inside hot pickup paths — keeping the cap math pure even when a
// future system pre-emits a payload before its def lands.
export function getItemWeight(id: ItemId): number {
  return ITEM_DEFS.get(id)?.weight ?? 0;
}

// True if the item is item-level sticky (auto-deposit always skips it).
// Per-job stickiness lives on Job.holdItems; the union of the two is
// what the controller's deposit gate consults.
export function isItemDefaultSticky(id: ItemId): boolean {
  return ITEM_DEFS.get(id)?.defaultSticky === true;
}

// Hunger units restored per unit consumed. 0 = not food. Used by the
// settler eat-from-crate task to filter eligible crate contents and to
// compute the hunger jump on a successful eat.
export function getFoodValue(id: number): number {
  return ITEM_DEFS.get(id as ItemId)?.foodValue ?? 0;
}

export function isFoodItem(id: number): boolean {
  return getFoodValue(id) > 0;
}
