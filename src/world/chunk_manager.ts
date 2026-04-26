// Bridges the camera, generation pool, LRU cache, and renderer. Each frame
// the caller hands a visible-chunk rect; the manager makes the GPU and CPU
// states match it: ensure visible chunks have GPU buffers, free GPU for
// chunks that left the view, dispatch generation for chunks not yet loaded,
// and let the LRU cache evict CPU entries beyond capacity.
//
// Invariants enforced here:
//  - A chunk on the GPU always has a CPU entry. (cache.onEvict drops GPU.)
//  - At most one outstanding generation per chunk key. (`inFlight` set.)
//  - Generation results that arrive after the chunk left view still land in
//    the CPU cache; only GPU upload is gated on still being visible.
//  - DIRTY_RENDER on a record triggers a buffer rebuild on the next update().

import type { InstancedTileRenderer } from "../rendering/instanced_tile_renderer";
import type { GenerationPool } from "../workers/generation_pool";
import {
  buildInstanceBuffer,
  CHUNK_FLAG_DIRTY_RENDER,
  CHUNK_FLAG_DIRTY_SIMULATION,
  type ChunkData,
  type ChunkRecord,
  makeChunkRecord,
  TILES_PER_CHUNK,
} from "./chunk";
import { ChunkCache } from "./chunk_cache";
import { type ChunkRect, chunkKey, chunkOriginWorldTile } from "./coords";

export interface ChunkManagerHooks {
  // Fires when a chunk first lands in the cache (generation finished or save
  // preloaded it). Use for systems that mirror chunk data — pathfinding
  // walkability mask is the first consumer.
  onChunkLoaded?: (chunkX: number, chunkY: number, data: ChunkData) => void;
  // Fires when a chunk is evicted from the LRU cache or removed via clear.
  onChunkEvicted?: (chunkX: number, chunkY: number) => void;
  // Fires when a chunk's tile data changes (DIRTY_SIMULATION marked).
  // Mirrors should re-derive their per-chunk views.
  onChunkMutated?: (chunkX: number, chunkY: number, data: ChunkData) => void;
}

export interface ChunkManagerOptions {
  pool: GenerationPool;
  renderer: InstancedTileRenderer;
  cacheCapacity: number;
  hooks?: ChunkManagerHooks;
}

export interface UpdateOptions {
  // Chunks that must keep simulating even when not visible. Typically
  // the chunks containing live entities. Pinned via the cache keep set
  // (no eviction) and via a generation request when not yet loaded.
  // No GPU upload happens for these — they're sim-only.
  simKeepSet?: ReadonlySet<string>;
}

// Parsed chunkKey back to (chunkX, chunkY). Format is "<x>,<y>" — see coords.ts.
function parseChunkKey(key: string): [number, number] {
  const comma = key.indexOf(",");
  return [Number(key.slice(0, comma)), Number(key.slice(comma + 1))];
}

export class ChunkManager {
  private readonly pool: GenerationPool;
  private readonly renderer: InstancedTileRenderer;
  private readonly cache: ChunkCache<ChunkRecord>;
  private readonly inFlight = new Set<string>();
  // Cache-protection set. Union of the render rect and the sim-only
  // pin set passed by the caller. Eviction skips any key in this set.
  private currentKeepSet = new Set<string>();
  // Just the render rect from the most recent update(). Used by the
  // async generation callback to decide whether to upload a freshly
  // arrived chunk to the GPU — sim-only pins must NOT trigger uploads
  // (they're off-screen by definition).
  private currentRenderKeepSet = new Set<string>();
  private readonly hooks: ChunkManagerHooks;
  // Single Float32Array reused for every uploadToGpu call. buildInstanceBuffer
  // writes into it in place; the renderer copies it into the GPU buffer
  // synchronously inside addChunk, so reusing across uploads is safe.
  // Eliminates ~4 KB allocation per chunk upload (5–10 chunks/frame on rapid
  // pans → 20–40 KB/frame of garbage if we allocated fresh each time).
  private readonly instanceScratch: Float32Array = new Float32Array(TILES_PER_CHUNK * 4);

  constructor(opts: ChunkManagerOptions) {
    this.pool = opts.pool;
    this.renderer = opts.renderer;
    this.hooks = opts.hooks ?? {};
    this.cache = new ChunkCache<ChunkRecord>({
      capacity: opts.cacheCapacity,
      onEvict: (key) => {
        this.renderer.removeChunk(key);
        const [cx, cy] = parseChunkKey(key);
        this.hooks.onChunkEvicted?.(cx, cy);
      },
    });
  }

  get cacheSize(): number {
    return this.cache.size;
  }

  get inFlightCount(): number {
    return this.inFlight.size;
  }

  // Direct read for tile interaction / save serialization. Returns the cached
  // record without promoting LRU; callers that mutate must also call
  // markDirty() so the renderer knows to rebuild.
  peekChunk(chunkX: number, chunkY: number): ChunkRecord | null {
    return this.cache.peek(chunkKey(chunkX, chunkY)) ?? null;
  }

  // Mark dirty for both render (next update will reupload) and simulation
  // (next save will persist). Used by tile actions and sim-result handling.
  // The mutated hook fires on DIRTY_SIMULATION transitions (low → high) so
  // walkability mirrors don't get spammed for repeat marks within one frame —
  // the hook fires once per logical mutation, not once per call.
  markDirty(chunkX: number, chunkY: number, flags = CHUNK_FLAG_DIRTY_RENDER): void {
    const record = this.peekChunk(chunkX, chunkY);
    if (!record) return;
    const wasSimDirty = (record.flags & CHUNK_FLAG_DIRTY_SIMULATION) !== 0;
    record.flags |= flags;
    if (!wasSimDirty && (flags & CHUNK_FLAG_DIRTY_SIMULATION) !== 0) {
      this.hooks.onChunkMutated?.(chunkX, chunkY, record.data);
    }
  }

  // Pre-install a chunk from save before any generation runs. Avoids
  // regeneration of a player-modified chunk on world load.
  preloadChunk(chunkX: number, chunkY: number, data: ChunkData): void {
    const key = chunkKey(chunkX, chunkY);
    // Saved chunks come back already in sync with disk and need GPU upload,
    // so DIRTY_SIMULATION clears and DIRTY_RENDER stays.
    this.cache.set(key, makeChunkRecord(data, CHUNK_FLAG_DIRTY_RENDER), this.currentKeepSet);
    this.hooks.onChunkLoaded?.(chunkX, chunkY, data);
  }

  // Iterate every chunk that has unsaved player/sim changes. Save manager
  // calls this to know what chunks to persist.
  *dirtySimChunks(): IterableIterator<{ chunkX: number; chunkY: number; data: ChunkData }> {
    for (const [key, record] of this.cache.entries()) {
      if ((record.flags & CHUNK_FLAG_DIRTY_SIMULATION) === 0) continue;
      const [cx, cy] = parseChunkKey(key);
      yield { chunkX: cx, chunkY: cy, data: record.data };
    }
  }

  // All cached chunk records by key. Used by the sim loop to find chunks
  // that need ticking. Iterates without promoting LRU.
  allChunkRecords(): IterableIterator<[string, ChunkRecord]> {
    return this.cache.entries();
  }

  clearSimulationDirty(chunkX: number, chunkY: number): void {
    const record = this.peekChunk(chunkX, chunkY);
    if (record) record.flags &= ~CHUNK_FLAG_DIRTY_SIMULATION;
  }

  // Per-frame update.
  //
  // `rect` is the *render* keep set: chunks the camera can see. They get
  // GPU buffers + walkability masks + entry in the LRU cache.
  //
  // `opts.simKeepSet` is the *sim-only* keep set: chunks that must keep
  // ticking even when off-screen (typically the chunks containing live
  // entities). They get a cache slot + walkability mask but no GPU
  // upload. Settlers in distant farms keep working while the camera
  // is elsewhere — entity ticks are main-thread and don't depend on
  // visibility, but pathfinding does, so the mask MUST stay live.
  //
  // Cache protection unions both sets; eviction can only target chunks
  // that are neither rendered nor sim-pinned.
  update(rect: ChunkRect, opts: UpdateOptions = {}): void {
    const renderKeepSet = new Set<string>();
    for (let cy = rect.minY; cy < rect.maxY; cy++) {
      for (let cx = rect.minX; cx < rect.maxX; cx++) {
        renderKeepSet.add(chunkKey(cx, cy));
      }
    }
    // Cache protection: render set ∪ sim set. Reused as `currentKeepSet`
    // for any cache.set inside this frame's requestGeneration callbacks
    // (those run async; by the time they fire `currentKeepSet` will have
    // moved on, but the protection is still correct because the sim
    // set's contents converge on the live entity set).
    this.currentRenderKeepSet = renderKeepSet;
    if (opts.simKeepSet && opts.simKeepSet.size > 0) {
      // Build a fresh union so the rect set isn't mutated. Cheap; sim
      // set is bounded by the entity count.
      const union = new Set(renderKeepSet);
      for (const k of opts.simKeepSet) union.add(k);
      this.currentKeepSet = union;
    } else {
      this.currentKeepSet = renderKeepSet;
    }

    // Free GPU buffers for chunks no longer visible. CPU data stays in
    // the LRU cache so a quick pan-back is a hit, no regeneration.
    // Sim-only pinned chunks are never on the GPU in the first place.
    const toRemoveFromGpu: string[] = [];
    for (const key of this.renderer.chunkKeys()) {
      if (!renderKeepSet.has(key)) toRemoveFromGpu.push(key);
    }
    for (const key of toRemoveFromGpu) this.renderer.removeChunk(key);

    // Walk the visible rect; install, refresh, or request each chunk.
    for (let cy = rect.minY; cy < rect.maxY; cy++) {
      for (let cx = rect.minX; cx < rect.maxX; cx++) {
        const key = chunkKey(cx, cy);
        const cached = this.cache.get(key);

        if (cached) {
          const dirty = (cached.flags & CHUNK_FLAG_DIRTY_RENDER) !== 0;
          if (!this.renderer.hasChunk(key) || dirty) {
            this.uploadToGpu(key, cached.data, cx, cy);
            cached.flags &= ~CHUNK_FLAG_DIRTY_RENDER;
          }
          continue;
        }

        if (this.inFlight.has(key)) continue;
        this.requestGeneration(key, cx, cy);
      }
    }

    // Walk the sim-only keep set. Each chunk that isn't already
    // loaded gets a generation request — without it, settlers spawned
    // by save load (or that wandered off-screen on a freshly streamed
    // chunk) would have no walkability mask and pathfinding would fail.
    // We deliberately use cache.peek so the LRU order doesn't get
    // promoted by the off-screen scan: if cache pressure pushes us
    // toward eviction, we want recently-rendered chunks to lead, not
    // sim-pinned ones (which the keep set already protects).
    if (opts.simKeepSet) {
      for (const key of opts.simKeepSet) {
        if (renderKeepSet.has(key)) continue; // already handled above
        if (this.cache.peek(key)) continue; // loaded; keep set protects
        if (this.inFlight.has(key)) continue;
        const [cx, cy] = parseChunkKey(key);
        this.requestGeneration(key, cx, cy);
      }
    }
  }

  private uploadToGpu(key: string, data: ChunkData, chunkX: number, chunkY: number): void {
    const [worldX, worldY] = chunkOriginWorldTile(chunkX, chunkY);
    buildInstanceBuffer(data, worldX, worldY, this.instanceScratch);
    this.renderer.addChunk(key, this.instanceScratch);
  }

  private requestGeneration(key: string, chunkX: number, chunkY: number): void {
    this.inFlight.add(key);
    this.pool
      .generate(chunkX, chunkY)
      .then((data) => {
        this.inFlight.delete(key);
        // Always cache (cheap; lets future pans hit). Pass current keepSet
        // as protected so freshly visible chunks aren't evicted to make room.
        this.cache.set(key, makeChunkRecord(data, CHUNK_FLAG_DIRTY_RENDER), this.currentKeepSet);
        this.hooks.onChunkLoaded?.(chunkX, chunkY, data);
        // Only upload to GPU if the chunk is in the *render* rect.
        // Sim-only pinned chunks (off-screen entity carriers) must
        // not consume a GPU buffer slot.
        if (this.currentRenderKeepSet.has(key) && !this.renderer.hasChunk(key)) {
          this.uploadToGpu(key, data, chunkX, chunkY);
          // Clear render dirty since we just uploaded.
          const rec = this.peekChunk(chunkX, chunkY);
          if (rec) rec.flags &= ~CHUNK_FLAG_DIRTY_RENDER;
        }
      })
      .catch((err) => {
        this.inFlight.delete(key);
        console.error(`generation failed for chunk ${key}`, err);
      });
  }
}
