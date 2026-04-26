// Recency-ordered chunk cache. Built on JS Map (which preserves insertion
// order); on every access the entry is removed and re-inserted to push it to
// the most-recently-used end. Eviction pops from the least-recently-used
// (oldest) end when over capacity.

export interface ChunkCacheOptions<V> {
  capacity: number;
  // Optional hook fired when an entry leaves the cache. Used by ChunkManager
  // to release GPU buffers; receives the value plus the key for context.
  onEvict?: (key: string, value: V) => void;
}

export class ChunkCache<V> {
  private readonly map = new Map<string, V>();
  private readonly capacity: number;
  private readonly onEvict: ((key: string, value: V) => void) | undefined;

  constructor(options: ChunkCacheOptions<V>) {
    if (options.capacity <= 0) {
      throw new Error(`ChunkCache capacity must be positive, got ${options.capacity}`);
    }
    this.capacity = options.capacity;
    this.onEvict = options.onEvict;
  }

  get size(): number {
    return this.map.size;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  get(key: string): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    // Promote to most-recently-used. Map.delete + Map.set is the cheapest way
    // to reorder without rebuilding the iterator.
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  // Look up a value without touching LRU order. Used on hot paths where the
  // caller just wants the data (mark dirty, sim-loop scan, click action) and
  // promoting recency on every read would be both wasteful and semantically
  // wrong — those reads aren't "user activity" against the chunk.
  peek(key: string): V | undefined {
    return this.map.get(key);
  }

  // Insert or replace. Promotes to MRU and evicts oldest until size ≤ capacity.
  // Caller-provided `protectedKeys` are never evicted on this insert; they
  // represent chunks the camera currently needs.
  set(key: string, value: V, protectedKeys?: ReadonlySet<string>): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    this.evictUntilWithinCapacity(protectedKeys);
  }

  delete(key: string): boolean {
    const value = this.map.get(key);
    if (value === undefined) return false;
    this.map.delete(key);
    if (this.onEvict) this.onEvict(key, value);
    return true;
  }

  clear(): void {
    if (this.onEvict) {
      for (const [key, value] of this.map) this.onEvict(key, value);
    }
    this.map.clear();
  }

  // Iterate in MRU-first order without exposing the map. Used by tests and by
  // ChunkManager when it needs to render in deterministic order. Returns the
  // Map's iterator directly so generator-method chaining doesn't get hit by
  // any host quirks (some bundlers compile class generators into helpers
  // whose returned object isn't recognized by `yield*` in another generator).
  entries(): IterableIterator<[string, V]> {
    return this.map.entries();
  }

  private evictUntilWithinCapacity(protectedKeys: ReadonlySet<string> | undefined): void {
    if (this.map.size <= this.capacity) return;
    // Map.keys() iterates oldest → newest, which is the LRU eviction order.
    const iter = this.map.keys();
    while (this.map.size > this.capacity) {
      const next = iter.next();
      if (next.done) break;
      const key = next.value;
      if (protectedKeys?.has(key)) continue;
      const value = this.map.get(key) as V;
      this.map.delete(key);
      if (this.onEvict) this.onEvict(key, value);
    }
  }
}
