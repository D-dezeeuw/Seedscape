// Pure A*-on-grid pathfinder. Lives in a module the worker imports so it can
// also be exercised by unit tests on the main thread (no DOM, no Worker API).
//
// Grid representation:
//   - Walkability is sparse-keyed by chunk: Map<chunkKey, Uint8Array(1024)>.
//     Outside loaded chunks the world is treated as blocked — settlers should
//     never plan into the unknown.
//   - World coords are signed integers. The search workspace is a flat
//     bounding-box buffer sized once at construction (MAX_DIM × MAX_DIM) and
//     reused across requests via a generation counter (no per-request clears).
//
// Determinism:
//   - 4-cardinal neighbours, fixed expansion order (N, E, S, W).
//   - Manhattan heuristic (admissible for unit-cost grid).
//   - Tie-break: lower fScore first; on equal fScore, lower cell index — so
//     the same (start, goal, grid) input always returns the same waypoints.

import { CHUNK_SIZE } from "../world/chunk";
import { chunkKey } from "../world/coords";

export const MAX_DIM = 256; // hard cap on bbox side; larger requests fail
const MAX_CELLS = MAX_DIM * MAX_DIM;
const NO_PARENT = -1;

export interface PathGrid {
  // chunkKey -> walkability mask. 1 = walkable, 0 = blocked / unknown.
  masks: Map<string, Uint8Array>;
}

export interface PathRequest {
  start: { x: number; y: number };
  goal: { x: number; y: number };
  // Soft cap on expanded nodes. Caller-controlled so pathological searches
  // can't lock the worker. Default chosen so a worst-case zig-zag through
  // the bbox still completes before we give up.
  maxNodes?: number;
}

export interface PathResult {
  // Flat (x0, y0, x1, y1, ...) world tile coords. Empty if no path. The first
  // waypoint is `start`; the last is `goal`. Length always even.
  waypoints: Int16Array;
  // Whether the search succeeded. `false` covers both "no reachable path" and
  // "search aborted (maxNodes / bbox too large)".
  found: boolean;
  // Nodes the search expanded — exposed for budget tuning, not for gameplay.
  expanded: number;
}

export function emptyResult(found = false, expanded = 0): PathResult {
  return { waypoints: new Int16Array(0), found, expanded };
}

// Lookup walkability for a single world tile via the chunk-keyed mask.
export function isWalkable(grid: PathGrid, wx: number, wy: number): boolean {
  const cx = Math.floor(wx / CHUNK_SIZE);
  const cy = Math.floor(wy / CHUNK_SIZE);
  const mask = grid.masks.get(chunkKey(cx, cy));
  if (!mask) return false; // unknown chunk = treat as blocked
  const lx = wx - cx * CHUNK_SIZE;
  const ly = wy - cy * CHUNK_SIZE;
  return (mask[ly * CHUNK_SIZE + lx] ?? 0) === 1;
}

// Reusable workspace. One instance per pathfinder (one per worker, one per
// test) — pinned by generation counter so we never zero-fill between
// requests. Each cell's `gen` is compared against `currentGen`; if it
// doesn't match, the cell is treated as untouched.
export class PathfinderWorkspace {
  // gScore: cost from start to this cell.
  readonly gScore = new Float32Array(MAX_CELLS);
  // fScore: gScore + heuristic. Used as the heap key.
  readonly fScore = new Float32Array(MAX_CELLS);
  // parent[i] = cell index of the predecessor, or NO_PARENT for the start.
  readonly parent = new Int32Array(MAX_CELLS);
  // generation tag per cell. !== currentGen → cell was never touched in this run.
  readonly cellGen = new Uint32Array(MAX_CELLS);
  // Closed-set bit (per generation): cellClosed[i]===currentGen → already expanded.
  readonly cellClosed = new Uint32Array(MAX_CELLS);
  // Min-heap of cell indices, keyed by fScore. Sized to MAX_CELLS — sufficient
  // because the heap can never hold more than the workspace's cell count.
  readonly heap = new Int32Array(MAX_CELLS);
  heapSize = 0;
  currentGen = 0;
}

function manhattan(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

// Heap helpers. Compare on fScore; tie-break on cell index for determinism.
function heapLess(ws: PathfinderWorkspace, a: number, b: number): boolean {
  const fa = ws.fScore[a] as number;
  const fb = ws.fScore[b] as number;
  if (fa !== fb) return fa < fb;
  return a < b;
}

function heapSwap(ws: PathfinderWorkspace, i: number, j: number): void {
  const ai = ws.heap[i] as number;
  const aj = ws.heap[j] as number;
  ws.heap[i] = aj;
  ws.heap[j] = ai;
}

function heapSiftUp(ws: PathfinderWorkspace, idx: number): void {
  while (idx > 0) {
    const parent = (idx - 1) >> 1;
    if (heapLess(ws, ws.heap[idx] as number, ws.heap[parent] as number)) {
      heapSwap(ws, idx, parent);
      idx = parent;
    } else {
      return;
    }
  }
}

function heapSiftDown(ws: PathfinderWorkspace, idx: number): void {
  for (;;) {
    const l = idx * 2 + 1;
    const r = l + 1;
    let smallest = idx;
    if (l < ws.heapSize && heapLess(ws, ws.heap[l] as number, ws.heap[smallest] as number)) {
      smallest = l;
    }
    if (r < ws.heapSize && heapLess(ws, ws.heap[r] as number, ws.heap[smallest] as number)) {
      smallest = r;
    }
    if (smallest === idx) return;
    heapSwap(ws, idx, smallest);
    idx = smallest;
  }
}

function heapPush(ws: PathfinderWorkspace, cell: number): void {
  ws.heap[ws.heapSize] = cell;
  ws.heapSize++;
  heapSiftUp(ws, ws.heapSize - 1);
}

function heapPop(ws: PathfinderWorkspace): number {
  const top = ws.heap[0] as number;
  ws.heapSize--;
  if (ws.heapSize > 0) {
    ws.heap[0] = ws.heap[ws.heapSize] as number;
    heapSiftDown(ws, 0);
  }
  return top;
}

// Bounding box for the search. Padded so detours around obstacles within the
// box are still reachable. Padding is proportional to manhattan distance
// (capped) so short paths stay cheap and long paths still get room to detour.
function computeBBox(req: PathRequest): { ox: number; oy: number; w: number; h: number } | null {
  const { start, goal } = req;
  const dx = Math.abs(goal.x - start.x);
  const dy = Math.abs(goal.y - start.y);
  const pad = Math.min(48, Math.max(8, Math.floor((dx + dy) / 2)));
  const minX = Math.min(start.x, goal.x) - pad;
  const minY = Math.min(start.y, goal.y) - pad;
  const maxX = Math.max(start.x, goal.x) + pad;
  const maxY = Math.max(start.y, goal.y) + pad;
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  if (w > MAX_DIM || h > MAX_DIM) return null;
  return { ox: minX, oy: minY, w, h };
}

export function findPath(
  grid: PathGrid,
  request: PathRequest,
  ws: PathfinderWorkspace,
): PathResult {
  const { start, goal } = request;
  const maxNodes = request.maxNodes ?? 8192;

  // Trivial cases.
  if (start.x === goal.x && start.y === goal.y) {
    const out = new Int16Array(2);
    out[0] = start.x;
    out[1] = start.y;
    return { waypoints: out, found: true, expanded: 0 };
  }
  if (!isWalkable(grid, start.x, start.y)) return emptyResult(false, 0);
  if (!isWalkable(grid, goal.x, goal.y)) return emptyResult(false, 0);

  const bbox = computeBBox(request);
  if (!bbox) return emptyResult(false, 0);
  const { ox, oy, w, h } = bbox;

  // Cell index helper local to this search.
  const cellOf = (wx: number, wy: number): number => (wy - oy) * w + (wx - ox);

  // Bump generation; all reads check cellGen[i] === gen / cellClosed[i] === gen.
  ws.currentGen++;
  // Wrap-around safety: Uint32 generation; on overflow, zero the arrays once.
  // 4 billion paths is unrealistic but cheap to handle.
  if (ws.currentGen === 0) {
    ws.cellGen.fill(0);
    ws.cellClosed.fill(0);
    ws.currentGen = 1;
  }
  ws.heapSize = 0;
  const gen = ws.currentGen;

  const startCell = cellOf(start.x, start.y);
  const goalCell = cellOf(goal.x, goal.y);
  ws.gScore[startCell] = 0;
  ws.fScore[startCell] = manhattan(start.x, start.y, goal.x, goal.y);
  ws.parent[startCell] = NO_PARENT;
  ws.cellGen[startCell] = gen;
  heapPush(ws, startCell);

  let expanded = 0;
  // Fixed neighbour order: N, E, S, W. Determinism survives heap tie-breaks
  // because the heap's secondary key is cell index, which encodes (y, x).
  const NX = [0, 1, 0, -1];
  const NY = [-1, 0, 1, 0];

  while (ws.heapSize > 0) {
    const current = heapPop(ws);
    // Stale heap entry — the cell was re-inserted with a better score; skip.
    if (ws.cellClosed[current] === gen) continue;
    ws.cellClosed[current] = gen;

    if (current === goalCell) {
      // Reconstruct waypoints by walking parents back to start.
      let length = 0;
      let cell = current;
      // Count first so we can size the Int16Array exactly.
      while (cell !== NO_PARENT) {
        length++;
        const p = ws.parent[cell] as number;
        if (p === NO_PARENT) break;
        cell = p;
      }
      const out = new Int16Array(length * 2);
      cell = current;
      for (let i = length - 1; i >= 0; i--) {
        const cy = Math.floor(cell / w);
        const cx = cell - cy * w;
        out[i * 2] = ox + cx;
        out[i * 2 + 1] = oy + cy;
        const p = ws.parent[cell] as number;
        if (p === NO_PARENT) break;
        cell = p;
      }
      return { waypoints: out, found: true, expanded };
    }

    expanded++;
    if (expanded > maxNodes) return emptyResult(false, expanded);

    const cy = Math.floor(current / w);
    const cx = current - cy * w;
    const wx = ox + cx;
    const wy = oy + cy;
    const gCurrent = ws.gScore[current] as number;
    const gNext = gCurrent + 1;

    for (let n = 0; n < 4; n++) {
      const nwx = wx + (NX[n] as number);
      const nwy = wy + (NY[n] as number);
      // Bbox bound check.
      if (nwx < ox || nwx >= ox + w || nwy < oy || nwy >= oy + h) continue;
      if (!isWalkable(grid, nwx, nwy)) continue;
      const ncell = cellOf(nwx, nwy);
      if (ws.cellClosed[ncell] === gen) continue;

      const known = ws.cellGen[ncell] === gen;
      const gPrev = known ? (ws.gScore[ncell] as number) : Number.POSITIVE_INFINITY;
      if (gNext >= gPrev) continue;

      ws.gScore[ncell] = gNext;
      ws.fScore[ncell] = gNext + manhattan(nwx, nwy, goal.x, goal.y);
      ws.parent[ncell] = current;
      ws.cellGen[ncell] = gen;
      heapPush(ws, ncell);
    }
  }

  return emptyResult(false, expanded);
}
