# Seedscape — Memory & Performance

## Principle

Every allocation decision is made at design time, not runtime. Avoid GC. Minimize fragmentation.

---

## Memory Model Comparison

| Model        | Memory/chunk | Speed  | GC pressure | Verdict        |
|--------------|-------------|--------|-------------|----------------|
| Plain objects| ~400 KB     | Slow   | High        | Not viable     |
| Typed arrays | ~3.1 KB     | Fast   | None        | Baseline       |
| Packed Uint32| ~2 KB       | Fastest| None        | Best           |

**Decision:** Typed arrays (Uint16 + Uint8). Packed Uint32 considered for future optimization pass.

---

## Chunk Memory Budget

| Layer              | Budget per chunk |
|--------------------|-----------------|
| CPU tile data      | 3.1 KB          |
| GPU instance buffer| 16 KB           |
| Entity list        | ~1–2 KB (var.)  |
| Metadata / flags   | 64 bytes        |
| **Total (active)** | **~21 KB**      |

### LRU Cache Budget

Target: 512 chunks in memory (~10 MB CPU, ~8 MB GPU).

Visible at once (1080p, zoom out): ~100–200 chunks.

---

## GPU Memory Limits

| Resource           | Limit       |
|--------------------|-------------|
| Total VRAM budget  | 512 MB      |
| Instance buffers   | 128 MB      |
| Texture atlas      | 64 MB       |
| Framebuffers       | 32 MB       |
| Reserve            | 288 MB      |

---

## LRU Cache Strategy

- Chunks evicted when count exceeds `MAX_CACHED_CHUNKS` (default: 512)
- Eviction priority: farthest from camera center
- Dirty chunks write back to save before eviction
- GPU buffers freed immediately on eviction

```
Cache order:
  1. Keep: active simulation range (player +3 chunks)
  2. Keep: visible render range (camera frustum)
  3. Evict: LRU outside both ranges
```

---

## GC Avoidance Rules

- No `new Object()` or `{}` in hot paths (simulation loop, render loop)
- No array spread in tick functions
- Pre-allocate worker message buffers; transfer via `Transferable`
- Entity pools: fixed-size typed buffers, not dynamic arrays
- Recycle chunk data buffers on eviction/reload

---

## Worker Memory Model

Each worker receives a `SharedArrayBuffer` or `Transferable` chunk payload.

- No object cloning across worker boundary
- Workers allocate their own output buffers
- Buffers transferred back to main thread on completion

---

## Worker Throughput Expectations

| Task                   | Target time |
|------------------------|-------------|
| Chunk generation       | <50ms       |
| Simulation tick (chunk)| <5ms        |
| Mesh build             | <10ms       |
| GPU buffer upload      | <10ms       |

---

## Render Performance Targets

| Metric              | Target        |
|---------------------|---------------|
| Frame time          | <16ms (60fps) |
| Draw calls / frame  | <200          |
| Visible tiles       | 50K–200K      |
| Chunk buffer upload | <10ms         |

---

## Simulation Performance Targets

| Metric              | Target    |
|---------------------|-----------|
| Tick rate           | 5–20 TPS  |
| Tick time (total)   | <50ms     |
| Active chunks/tick  | ≤32       |
| Entities/chunk      | ≤64       |
