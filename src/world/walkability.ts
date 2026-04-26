// Entity walkability test — used by wander AI and (later) possessed-avatar
// movement to decide whether a tile is reachable. Conservative for MVP:
// water and placed buildings block, everything else is walkable.
//
// Crops and tilled farmland are walkable — players in farming sims are
// used to walking over their crops without trampling them. Marsh / soft
// ground is walkable for entities even though it's non-buildable, so a
// villager near the river can wander through it.

const SHALLOW_WATER = 0;
const DEEP_WATER = 1;
const SWAMP_WATER = 30;

export function isEntityWalkable(tileId: number): boolean {
  // Buildings (200..299) block.
  if (tileId >= 200 && tileId <= 299) return false;
  // Water tiles block.
  if (tileId === SHALLOW_WATER || tileId === DEEP_WATER || tileId === SWAMP_WATER) return false;
  return true;
}
