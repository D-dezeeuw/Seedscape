// Per-building input/output buffers. Phase 8 introduces these so settlers
// (not the player UI) feed buildings and haul their output: the input
// buffer is what waiting cargo gets dropped into; the output buffer is
// where finished cycles write their result, awaiting a HAUL_OUTPUT job.
//
// Like CrateStore, this is a sparse main-thread store keyed by world-tile
// coords. Buildings are rare, so a flat per-chunk array would waste 99%
// of its slots. Per tile we keep TWO maps: input (item -> count) and
// output (item -> count). They're separate because a building's
// outputItem can equal its inputItem (e.g. a refinery feeding itself in
// future phases) and we'd otherwise mix waiting-to-consume with
// produced-output.
//
// Capacity: bounded multiples of cycleInput/cycleOutput so a stalled
// settler can't fill a tile until the next save. The auto-queue main-
// thread loop (see main.ts) consumes input → bumps the building's
// queued counter; the sim then runs the cycle as before. Output goes
// into the output buffer (no longer player inventory) — back-pressure
// stops production when no settler hauls.

import type { ItemId } from "../../state/items";

// Multipliers chosen so a settler hauling one cycle's worth at a time
// can stay ahead of a 30s cycle without buffers ever sitting full.
// Three cycles worth = ~1.5 minutes of headroom for input, slightly
// shorter on output (we'd rather production back off than fill an
// unbounded sink).
export const INPUT_BUFFER_MULTIPLIER = 3;
export const OUTPUT_BUFFER_MULTIPLIER = 3;

const tileKeyOf = (x: number, y: number): string => `${x | 0},${y | 0}`;
const parseTileKey = (key: string): [number, number] => {
  const comma = key.indexOf(",");
  return [Number(key.slice(0, comma)), Number(key.slice(comma + 1))];
};

export interface BuildingBufferSnapshot {
  // Two flat maps keyed by tile, mirroring CrateContentsSnapshot's shape
  // so save/load uses identical plumbing. Plain objects so structured
  // clone round-trips cleanly.
  input: { [tileKey: string]: { [itemId: number]: number } };
  output: { [tileKey: string]: { [itemId: number]: number } };
}

export class BuildingBufferStore {
  // tileKey -> ItemId -> count. Two separate sparse maps so iteration
  // (e.g. emitter scanning for input-low buildings) doesn't have to
  // disambiguate between input and output by item id.
  private readonly input = new Map<string, Map<ItemId, number>>();
  private readonly output = new Map<string, Map<ItemId, number>>();

  // ---- Input buffer ----

  totalInputAt(x: number, y: number): number {
    return totalIn(this.input.get(tileKeyOf(x, y)));
  }

  inputAt(x: number, y: number, item: ItemId): number {
    return this.input.get(tileKeyOf(x, y))?.get(item) ?? 0;
  }

  // Try to add `n` of `item` to a building's input buffer at (x,y),
  // clamped by `cap` (caller passes building.cycleInputQuantity *
  // INPUT_BUFFER_MULTIPLIER — keeps the cap math at the call site so
  // this store stays building-agnostic). Returns count actually added.
  addInput(x: number, y: number, item: ItemId, n: number, cap: number): number {
    return addClamped(this.input, tileKeyOf(x, y), item, n, cap);
  }

  // Remove and return up to `n` of `item` from the input buffer. Used
  // by the auto-queue tick when the building has enough input to start
  // a cycle.
  consumeInput(x: number, y: number, item: ItemId, n: number): number {
    return removeFrom(this.input, tileKeyOf(x, y), item, n);
  }

  // ---- Output buffer ----

  totalOutputAt(x: number, y: number): number {
    return totalIn(this.output.get(tileKeyOf(x, y)));
  }

  outputAt(x: number, y: number, item: ItemId): number {
    return this.output.get(tileKeyOf(x, y))?.get(item) ?? 0;
  }

  // Add output produced by a finished cycle. Clamped by `cap` —
  // production stops if cap is hit (back-pressure). Caller wires this
  // from the sim's ProductionEvent handler in main.ts.
  addOutput(x: number, y: number, item: ItemId, n: number, cap: number): number {
    return addClamped(this.output, tileKeyOf(x, y), item, n, cap);
  }

  // Remove and return up to `n` of `item` from the output buffer.
  // Settlers call this in the actAtSource step of HAUL_OUTPUT.
  consumeOutput(x: number, y: number, item: ItemId, n: number): number {
    return removeFrom(this.output, tileKeyOf(x, y), item, n);
  }

  // True iff the output buffer at (x,y) has any items (caller doesn't
  // care which kind). Used by the emitter to decide whether to emit a
  // HAUL_OUTPUT job.
  hasAnyOutput(x: number, y: number): boolean {
    const inner = this.output.get(tileKeyOf(x, y));
    return inner ? inner.size > 0 : false;
  }

  // First (item, count) pair in the output buffer at (x,y). Stable
  // because Map preserves insertion order — first item produced is
  // first to be hauled, FIFO at the tile level. Used by the emitter
  // to stamp the HAUL_OUTPUT job's payload.
  firstOutput(x: number, y: number): { item: ItemId; count: number } | null {
    const inner = this.output.get(tileKeyOf(x, y));
    if (!inner || inner.size === 0) return null;
    const [item, count] = inner.entries().next().value as [ItemId, number];
    return { item, count };
  }

  // ---- Lifecycle ----

  // Drop both buffers for a tile. Called when a building is dismantled
  // so the sparse store doesn't leak phantom contents.
  clearAt(x: number, y: number): void {
    const key = tileKeyOf(x, y);
    this.input.delete(key);
    this.output.delete(key);
  }

  // Iterate every tile that has either an input or output buffer.
  // Used for save serialization and the emitter's per-building scan.
  // Yields each tile once even if both buffers exist.
  *tiles(): IterableIterator<{ x: number; y: number }> {
    const seen = new Set<string>();
    for (const key of this.input.keys()) {
      seen.add(key);
      const [x, y] = parseTileKey(key);
      yield { x, y };
    }
    for (const key of this.output.keys()) {
      if (seen.has(key)) continue;
      const [x, y] = parseTileKey(key);
      yield { x, y };
    }
  }

  // ---- Persistence ----

  toJSON(): BuildingBufferSnapshot {
    return { input: dump(this.input), output: dump(this.output) };
  }

  loadFromJSON(snapshot: BuildingBufferSnapshot): void {
    this.input.clear();
    this.output.clear();
    load(this.input, snapshot.input ?? {});
    load(this.output, snapshot.output ?? {});
  }
}

// ---- Internals ----

function totalIn(inner: Map<ItemId, number> | undefined): number {
  if (!inner) return 0;
  let sum = 0;
  for (const n of inner.values()) sum += n;
  return sum;
}

function addClamped(
  store: Map<string, Map<ItemId, number>>,
  key: string,
  item: ItemId,
  n: number,
  cap: number,
): number {
  if (n <= 0) return 0;
  let inner = store.get(key);
  if (!inner) {
    inner = new Map();
    store.set(key, inner);
  }
  let total = 0;
  for (const c of inner.values()) total += c;
  const room = Math.max(0, cap - total);
  const stored = Math.min(n, room);
  if (stored === 0) return 0;
  inner.set(item, (inner.get(item) ?? 0) + stored);
  return stored;
}

function removeFrom(
  store: Map<string, Map<ItemId, number>>,
  key: string,
  item: ItemId,
  n: number,
): number {
  if (n <= 0) return 0;
  const inner = store.get(key);
  if (!inner) return 0;
  const have = inner.get(item) ?? 0;
  const taken = Math.min(have, n);
  if (taken === 0) return 0;
  const remaining = have - taken;
  if (remaining === 0) inner.delete(item);
  else inner.set(item, remaining);
  if (inner.size === 0) store.delete(key);
  return taken;
}

function dump(store: Map<string, Map<ItemId, number>>): {
  [tileKey: string]: { [itemId: number]: number };
} {
  const out: { [tileKey: string]: { [itemId: number]: number } } = {};
  for (const [key, inner] of store) {
    const slot: { [itemId: number]: number } = {};
    for (const [item, count] of inner) slot[item] = count;
    out[key] = slot;
  }
  return out;
}

function load(
  store: Map<string, Map<ItemId, number>>,
  snapshot: { [tileKey: string]: { [itemId: number]: number } },
): void {
  for (const [key, items] of Object.entries(snapshot)) {
    const inner = new Map<ItemId, number>();
    for (const [itemStr, count] of Object.entries(items)) {
      if (count > 0) inner.set(Number(itemStr) as ItemId, count);
    }
    if (inner.size > 0) store.set(key, inner);
  }
}
