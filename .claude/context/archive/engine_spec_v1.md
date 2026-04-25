# Seedscape WebGL Engine Spec (v1.0)

## 1. Engine Philosophy

Seedscape is a **GPU-first, chunk-streamed simulation renderer**.

### Core principles
- No per-tile CPU rendering logic
- Everything is chunk-based (32×32 tiles)
- CPU prepares buffers; GPU renders everything
- Simulation and rendering are decoupled
- Memory is flat (Typed Arrays only)
- WebGL2 is the minimum target

---

## 2. Rendering Architecture

### 2.1 Pipeline Overview

World State (Chunks)
→ Visibility System (CPU)
→ Chunk Mesh Builder (Worker)
→ GPU Buffer Upload
→ WebGL Instanced Renderer
→ Fragment Shader (Atlas Sampling)

---

### 2.2 Render Model

Each tile:
- 1 instance = 1 tile
- 1 draw call per chunk
- Shared quad geometry

---

### 2.3 Chunk Rendering Unit

- Chunk size: 32×32 tiles (1024 tiles)
- Each chunk contains:
  - CPU tile data
  - GPU instance buffer
  - Dirty flag

---

### 2.4 GPU Representation

Each tile instance contains:

- vec2 position (world space)
- float tileIndex (atlas lookup)
- float tileState (growth/variant flags)

Stored in `Float32Array`.

---

## 3. WebGL2 Core Design

### 3.1 Required Features

- WebGL2 only (no WebGL1 core path)
- Instanced rendering
- Texture atlases
- Buffer streaming
- No per-tile texture binding

---

### 3.2 Buffers

#### Static quad (shared)
Unit square:

(0,0) ---- (1,0)  
  |          |  
  |          |  
(1,0) ---- (1,1)

Used for all tiles.

---

#### Instance buffer (per chunk)

Float32Array layout:

[x, y, tileIndex, state, ...]

- 4 floats per tile

---

### 3.3 Buffer Update Rules

- Update only when chunk is dirty
- Never update per frame per tile
- Use buffer overwrite strategy

---

## 4. Shader Specification

### 4.1 Vertex Shader

Responsibilities:
- Transform tile position using camera
- Compute UV from atlas
- Pass tile state to fragment shader

Inputs:
- a_position (quad vertex)
- a_instanceData

Outputs:
- UV coordinates
- tile state

---

### 4.2 Fragment Shader

Responsibilities:
- Sample texture atlas
- Apply state-based modifications
- Optional lighting effects

---

### 4.3 Texture Atlas System

Formula:

tileX = mod(tileIndex, atlasWidth)
tileY = floor(tileIndex / atlasWidth)

Single texture, grid-based UV mapping.

---

## 5. Chunk System

### 5.1 Chunk Lifecycle

States:
- UNLOADED
- GENERATED
- DIRTY
- UPLOADED
- VISIBLE

---

### 5.2 Responsibilities

Chunk system handles:
- Loading/unloading
- Cache management
- Worker coordination
- Dirty tracking

---

### 5.3 Visibility System

- Camera-based chunk loading
- Radius + frustum-based culling
- Preload ring around viewport

---

## 6. Worker System

### Responsibilities
- Chunk generation
- Simulation updates
- Mesh building

---

### Worker Contract

Input:
{
  chunkX,
  chunkY,
  seed
}

Output:
{
  tileData,
  stateData
}

---

### Rule
Workers must be:
- Stateless
- Deterministic
- Pure functions

---

## 7. Simulation Engine

### 7.1 Fixed Tick System
- 5–20 ticks per second
- Independent from render FPS

---

### 7.2 Systems
- Crop growth
- Production chains
- Economy simulation
- Animal systems

All operate on chunk data only.

---

### 7.3 Determinism
- Seeded RNG required
- No system time usage
- Fully reproducible chunks

---

## 8. Memory Model

### CPU Chunk Data

- Uint16Array (tile IDs)
- Uint8Array (state)

~4 KB per chunk

---

### GPU Data

- Instance buffer per visible chunk
- Texture atlas (static)

---

### Cache Strategy

- LRU chunk cache
- Evict distant chunks only
- Dirty chunks retained until saved

---

## 9. Camera System

### Requirements
- Floating origin system
- No precision loss at scale
- Smooth interpolation

---

### Implementation
- Float64 world coordinates
- Float32 shader transforms
- Chunk-relative rendering

---

## 10. Input System

- Mouse → world mapping
- Tile selection via chunk lookup
- No DOM-based world interaction

---

## 11. Rendering Rules

### Forbidden
- No per-tile draw calls
- No DOM rendering of world
- No per-frame allocations
- No texture switching per tile

### Required
- Instanced rendering
- Chunk batching
- Texture atlas usage
- GPU-first rendering

---

## 12. Performance Targets

| Metric | Target |
|--------|--------|
| Draw calls | < 200 |
| Visible tiles | 50K–200K |
| Chunk load time | < 10ms |
| Frame time | < 16ms |

---

## 13. Failure Modes

### Too many chunks loaded
→ Fix: stricter LRU eviction

### GPU buffer thrashing
→ Fix: dirty batching

### Worker backlog
→ Fix: worker pool prioritization

---

## 14. Engine Module Layout

engine/
├── core/
├── rendering/
├── world/
├── workers/
├── simulation/
├── input/
├── gpu/

---

## 15. Key Insight

Seedscape is not a traditional game renderer.

It is:

> A chunk-streamed GPU simulation system with a minimal CPU orchestration layer.