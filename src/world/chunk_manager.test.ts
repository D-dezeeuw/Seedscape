// ChunkManager keeps off-screen entity-bearing chunks alive in the
// cache, ever-loads them on demand, and never uploads them to the GPU.
// These tests use minimal in-memory stand-ins for the renderer and
// the generation pool so we don't need a real GL context or worker.

import { describe, expect, test } from "vitest";
import type { InstancedTileRenderer } from "../rendering/instanced_tile_renderer";
import type { GenerationPool } from "../workers/generation_pool";
import { allocChunkData, type ChunkData, TILES_PER_CHUNK } from "./chunk";
import { ChunkManager, type ChunkManagerHooks } from "./chunk_manager";
import { chunkKey } from "./coords";

// Fake renderer: tracks which chunks have GPU buffers via a Set.
class FakeRenderer {
  readonly buffers = new Set<string>();
  addChunk(key: string, _data: Float32Array): void {
    this.buffers.add(key);
  }
  removeChunk(key: string): void {
    this.buffers.delete(key);
  }
  hasChunk(key: string): boolean {
    return this.buffers.has(key);
  }
  chunkKeys(): IterableIterator<string> {
    return this.buffers.values();
  }
}

// Fake generation pool: synchronously resolves with a fresh ChunkData.
// Tracks which keys it generated so tests can assert load behaviour.
class FakeGenerationPool {
  readonly generated: string[] = [];
  generate(cx: number, cy: number): Promise<ChunkData> {
    this.generated.push(chunkKey(cx, cy));
    const data = allocChunkData();
    // Fill with grass so walkability mask is non-trivial when the
    // hooks fire (some assertions look at masks indirectly).
    for (let i = 0; i < TILES_PER_CHUNK; i++) data.tileId[i] = 10;
    return Promise.resolve(data);
  }
  ready(): Promise<void> {
    return Promise.resolve();
  }
}

function makeManager(
  capacity: number,
  hooks: ChunkManagerHooks = {},
): {
  manager: ChunkManager;
  renderer: FakeRenderer;
  pool: FakeGenerationPool;
} {
  const renderer = new FakeRenderer();
  const pool = new FakeGenerationPool();
  const manager = new ChunkManager({
    pool: pool as unknown as GenerationPool,
    renderer: renderer as unknown as InstancedTileRenderer,
    cacheCapacity: capacity,
    hooks,
  });
  return { manager, renderer, pool };
}

async function flush(): Promise<void> {
  // Two microtask ticks so the generate Promise resolves and the
  // .then inside requestGeneration runs.
  await Promise.resolve();
  await Promise.resolve();
}

const RECT = (minX: number, minY: number, maxX: number, maxY: number) => ({
  minX,
  minY,
  maxX,
  maxY,
});

describe("ChunkManager simKeepSet", () => {
  test("sim-pinned chunks load when not visible (request generation)", async () => {
    const { manager, renderer, pool } = makeManager(64);
    // Camera looks at chunks (0,0)..(2,2). Settler is far away at (10,10).
    const sim = new Set([chunkKey(10, 10)]);
    manager.update(RECT(0, 0, 2, 2), { simKeepSet: sim });
    await flush();
    expect(pool.generated).toContain(chunkKey(10, 10));
    // Sim-only chunks must NOT be uploaded to the GPU.
    expect(renderer.buffers.has(chunkKey(10, 10))).toBe(false);
    // Visible chunks ARE uploaded.
    expect(renderer.buffers.has(chunkKey(0, 0))).toBe(true);
  });

  test("sim-pinned chunks survive cache pressure when LRU is exhausted", async () => {
    // Capacity = 4. Visit 8 distinct chunks across many frames; the
    // sim-pinned key (5,5) is on every update so it must survive.
    const { manager } = makeManager(4);
    const sim = new Set([chunkKey(5, 5)]);

    // Frame 1: rect (0,0)..(2,2) (4 chunks) + sim pin → 5 chunks total,
    // exceeds capacity. Eviction must skip the sim pin.
    manager.update(RECT(0, 0, 2, 2), { simKeepSet: sim });
    await flush();
    // Frames 2..n: walk a long line of fresh rects. Without protection
    // the sim chunk would drift to LRU end and get evicted.
    for (let i = 0; i < 10; i++) {
      manager.update(RECT(i * 10, 0, i * 10 + 2, 2), { simKeepSet: sim });
      await flush();
    }

    // Sim chunk should still be in the cache.
    const rec = manager.peekChunk(5, 5);
    expect(rec).not.toBeNull();
  });

  test("dropping the sim pin makes the chunk evictable again", async () => {
    const { manager } = makeManager(4);
    // Pin (5,5) initially.
    manager.update(RECT(0, 0, 2, 2), { simKeepSet: new Set([chunkKey(5, 5)]) });
    await flush();
    expect(manager.peekChunk(5, 5)).not.toBeNull();

    // Now drop the pin and walk fresh rects to push it out via LRU.
    for (let i = 0; i < 10; i++) {
      manager.update(RECT(i * 10, 0, i * 10 + 2, 2));
      await flush();
    }
    expect(manager.peekChunk(5, 5)).toBeNull();
  });

  test("onChunkLoaded fires for sim-only chunks (pathfinding mask gets pushed)", async () => {
    const loaded: Array<[number, number]> = [];
    const evicted: Array<[number, number]> = [];
    const { manager } = makeManager(64, {
      onChunkLoaded: (cx, cy) => loaded.push([cx, cy]),
      onChunkEvicted: (cx, cy) => evicted.push([cx, cy]),
    });
    manager.update(RECT(0, 0, 1, 1), { simKeepSet: new Set([chunkKey(20, 20)]) });
    await flush();
    // Visible (0,0) and sim-only (20,20) both fire onChunkLoaded.
    expect(loaded).toContainEqual([0, 0]);
    expect(loaded).toContainEqual([20, 20]);
    expect(evicted).toEqual([]);
  });

  test("sim chunks moving out of the pin set get evicted at the next cache-pressure event", async () => {
    const evicted: Array<[number, number]> = [];
    const { manager } = makeManager(2, {
      onChunkEvicted: (cx, cy) => evicted.push([cx, cy]),
    });
    manager.update(RECT(0, 0, 1, 1), { simKeepSet: new Set([chunkKey(5, 5)]) });
    await flush();
    expect(manager.peekChunk(5, 5)).not.toBeNull();
    // Settler walks away — (5,5) no longer pinned. Capacity is 2; we've
    // got (0,0) (rendered) + (5,5) (was pinned). Visit a fresh chunk
    // outside the rect to force eviction; (5,5) is the LRU candidate.
    manager.update(RECT(0, 0, 2, 1)); // adds (1,0) to keep set + cache
    await flush();
    // (5,5) should be the one evicted to make room.
    expect(evicted).toContainEqual([5, 5]);
  });

  test("rect-rendered chunks still upload to GPU regardless of sim set", async () => {
    const { manager, renderer } = makeManager(64);
    manager.update(RECT(0, 0, 2, 2), { simKeepSet: new Set([chunkKey(20, 20)]) });
    await flush();
    expect(renderer.buffers.has(chunkKey(0, 0))).toBe(true);
    expect(renderer.buffers.has(chunkKey(1, 1))).toBe(true);
    expect(renderer.buffers.has(chunkKey(20, 20))).toBe(false);
  });

  test("update with no simKeepSet preserves the original behaviour", async () => {
    const { manager, renderer } = makeManager(64);
    manager.update(RECT(0, 0, 2, 2));
    await flush();
    // 4 chunks visible, 4 GPU uploads, no sim chunks loaded.
    expect(renderer.buffers.size).toBe(4);
  });
});
