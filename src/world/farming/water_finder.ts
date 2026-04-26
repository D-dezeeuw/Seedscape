// Locate the nearest water source for a settler that needs to refill.
// "Water source" = a shallow-water tile or a well building. Deep water and
// swamp don't count — they're physically blocking and the settler can't
// reach the middle of a wide water body anyway.
//
// We look for a *neighbour* tile of the source: settlers stand on a
// walkable tile adjacent to the water, not in the water itself. The
// returned coords are the standing tile, not the water tile. The caller
// uses that as the path goal; the source tile is recorded in the job for
// debug visualization and reachability tests.

import { CHUNK_SIZE, type ChunkRecord, tileIndex } from "../chunk";
import { isEntityWalkable, isWaterSource } from "../walkability";

export interface ChunkSource {
  allChunkRecords(): IterableIterator<[string, ChunkRecord]>;
}

function parseChunkKey(key: string): [number, number] {
  const comma = key.indexOf(",");
  return [Number(key.slice(0, comma)), Number(key.slice(comma + 1))];
}

export interface WaterSourceHit {
  // The water tile itself.
  source: { x: number; y: number };
  // Where the settler stands to act. Always walkable.
  standing: { x: number; y: number };
}

// Returns the closest water source whose adjacent walkable tile is
// reachable by Manhattan distance from (fromX, fromY). Null if none found
// in any loaded chunk.
export function findNearestWaterSource(
  chunks: ChunkSource,
  fromX: number,
  fromY: number,
): WaterSourceHit | null {
  // Snapshot loaded chunks once so neighbour-tile lookups are O(1) hash hits
  // instead of re-walking the iterator for every candidate.
  const snap = new Map<string, ChunkRecord>();
  for (const [key, record] of chunks.allChunkRecords()) snap.set(key, record);

  const tileIdAt = (wx: number, wy: number): number | null => {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cy = Math.floor(wy / CHUNK_SIZE);
    const rec = snap.get(`${cx | 0},${cy | 0}`);
    if (!rec) return null;
    const lx = wx - cx * CHUNK_SIZE;
    const ly = wy - cy * CHUNK_SIZE;
    return rec.data.tileId[ly * CHUNK_SIZE + lx] ?? 0;
  };

  let best: WaterSourceHit | null = null;
  let bestDist = Number.POSITIVE_INFINITY;

  for (const [key, record] of snap) {
    const [cx, cy] = parseChunkKey(key);
    const baseX = cx * CHUNK_SIZE;
    const baseY = cy * CHUNK_SIZE;
    const data = record.data;
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const tileId = data.tileId[tileIndex(lx, ly)] ?? 0;
        if (!isWaterSource(tileId)) continue;
        const sx = baseX + lx;
        const sy = baseY + ly;
        const candidates = [
          { x: sx + 1, y: sy },
          { x: sx - 1, y: sy },
          { x: sx, y: sy + 1 },
          { x: sx, y: sy - 1 },
        ];
        for (const c of candidates) {
          const tile = tileIdAt(c.x, c.y);
          if (tile === null) continue;
          if (!isEntityWalkable(tile)) continue;
          const dist = Math.abs(c.x - fromX) + Math.abs(c.y - fromY);
          if (dist < bestDist) {
            bestDist = dist;
            best = { source: { x: sx, y: sy }, standing: c };
          }
        }
      }
    }
  }
  return best;
}
