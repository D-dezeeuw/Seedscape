// Animal placement helper. Walks every loaded chunk for pen tiles
// matching the requested species, finds the one nearest to a reference
// point (camera centre by default) that has no resident Animal yet,
// and returns its world-tile coords. The shop calls this when the
// player buys a Chicken / Cow — the new entity spawns at the
// returned tile.
//
// Capacity model: one animal per pen tile. Adjacent pen tiles form a
// visual pen but each holds its own animal. This keeps the spawn
// search trivial (no region detection) and lets a player scale herd
// size by placing more pen tiles.

import { Animal } from "../../state/entities/animal";
import type { EntityManager } from "../../state/entities/entity_manager";
import { CHUNK_SIZE, tileIndex } from "../chunk";
import type { ChunkManager } from "../chunk_manager";
import { isPenTile, penForTile } from "./pen_registry";

export interface EmptyPenHit {
  worldTileX: number;
  worldTileY: number;
}

// Find the empty pen tile of `species` closest (by squared distance)
// to (refX, refY). Returns null when no matching empty pen is loaded.
export function findEmptyPen(
  chunkManager: ChunkManager,
  entityManager: EntityManager,
  species: "chicken" | "cow",
  refX: number,
  refY: number,
): EmptyPenHit | null {
  // Collect every world-tile that already anchors an Animal so we can
  // skip those tiles in the search.
  const occupied = new Set<string>();
  for (const e of entityManager.iterate()) {
    if (e instanceof Animal) {
      occupied.add(`${e.penWorldTileX},${e.penWorldTileY}`);
    }
  }

  let best: EmptyPenHit | null = null;
  let bestDist = Number.POSITIVE_INFINITY;

  for (const [key, record] of chunkManager.allChunkRecords()) {
    const data = record.data;
    const [cxStr, cyStr] = key.split(",");
    const baseX = Number(cxStr) * CHUNK_SIZE;
    const baseY = Number(cyStr) * CHUNK_SIZE;
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const tileId = data.tileId[tileIndex(lx, ly)] ?? 0;
        if (!isPenTile(tileId)) continue;
        const def = penForTile(tileId);
        if (!def || def.species !== species) continue;
        const wx = baseX + lx;
        const wy = baseY + ly;
        if (occupied.has(`${wx},${wy}`)) continue;
        const dx = wx - refX;
        const dy = wy - refY;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
          bestDist = dist;
          best = { worldTileX: wx, worldTileY: wy };
        }
      }
    }
  }
  return best;
}
