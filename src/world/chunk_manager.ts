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

import type { InstancedTileRenderer } from "../rendering/instanced_tile_renderer";
import type { GenerationPool } from "../workers/generation_pool";
import { buildInstanceBuffer, type ChunkData } from "./chunk";
import { ChunkCache } from "./chunk_cache";
import { type ChunkRect, chunkKey, chunkOriginWorldTile } from "./coords";

export interface ChunkManagerOptions {
  pool: GenerationPool;
  renderer: InstancedTileRenderer;
  cacheCapacity: number;
}

export class ChunkManager {
  private readonly pool: GenerationPool;
  private readonly renderer: InstancedTileRenderer;
  private readonly cache: ChunkCache<ChunkData>;
  private readonly inFlight = new Set<string>();
  private currentKeepSet = new Set<string>();

  constructor(opts: ChunkManagerOptions) {
    this.pool = opts.pool;
    this.renderer = opts.renderer;
    this.cache = new ChunkCache<ChunkData>({
      capacity: opts.cacheCapacity,
      onEvict: (key) => this.renderer.removeChunk(key),
    });
  }

  get cacheSize(): number {
    return this.cache.size;
  }

  get inFlightCount(): number {
    return this.inFlight.size;
  }

  update(rect: ChunkRect): void {
    const keepSet = new Set<string>();
    for (let cy = rect.minY; cy < rect.maxY; cy++) {
      for (let cx = rect.minX; cx < rect.maxX; cx++) {
        keepSet.add(chunkKey(cx, cy));
      }
    }
    this.currentKeepSet = keepSet;

    // Free GPU buffers for chunks no longer visible. CPU data stays in the
    // LRU cache so a quick pan-back is a hit, no regeneration.
    const toRemoveFromGpu: string[] = [];
    for (const key of this.renderer.chunkKeys()) {
      if (!keepSet.has(key)) toRemoveFromGpu.push(key);
    }
    for (const key of toRemoveFromGpu) this.renderer.removeChunk(key);

    // Walk the visible rect; install or request each chunk.
    for (let cy = rect.minY; cy < rect.maxY; cy++) {
      for (let cx = rect.minX; cx < rect.maxX; cx++) {
        const key = chunkKey(cx, cy);
        if (this.renderer.hasChunk(key)) continue;

        const cached = this.cache.get(key);
        if (cached) {
          this.uploadToGpu(key, cached, cx, cy);
          continue;
        }

        if (this.inFlight.has(key)) continue;
        this.requestGeneration(key, cx, cy);
      }
    }
  }

  private uploadToGpu(key: string, data: ChunkData, chunkX: number, chunkY: number): void {
    const [worldX, worldY] = chunkOriginWorldTile(chunkX, chunkY);
    const buf = buildInstanceBuffer(data, worldX, worldY);
    this.renderer.addChunk(key, buf);
  }

  private requestGeneration(key: string, chunkX: number, chunkY: number): void {
    this.inFlight.add(key);
    this.pool
      .generate(chunkX, chunkY)
      .then((data) => {
        this.inFlight.delete(key);
        // Always cache (cheap; lets future pans hit). Pass current keepSet
        // as protected so freshly visible chunks aren't evicted to make room.
        this.cache.set(key, data, this.currentKeepSet);
        if (this.currentKeepSet.has(key) && !this.renderer.hasChunk(key)) {
          this.uploadToGpu(key, data, chunkX, chunkY);
        }
      })
      .catch((err) => {
        this.inFlight.delete(key);
        console.error(`generation failed for chunk ${key}`, err);
      });
  }
}
