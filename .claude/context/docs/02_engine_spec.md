# Seedscape — WebGL Engine Spec

## Engine Philosophy

Seedscape is a **GPU-first chunk simulation engine**.

---

## Core Architecture

World State → Visibility System → Worker Mesh Builder → GPU Upload → WebGL Renderer

---

## Chunk System

- Chunk size: 32×32 tiles
- Each chunk contains:
  - CPU tile arrays
  - GPU instance buffer
  - dirty flag

---

## GPU Model

Each tile instance:

- vec2 position
- float tileIndex
- float tileState

Stored in Float32Array.

---

## Rendering Model

- Instanced rendering only
- 1 draw call per chunk
- Shared quad geometry

---

## Required WebGL Features

- WebGL2
- Instanced rendering
- Texture atlas sampling
- Buffer streaming

---

## Buffers

### Static geometry
Unit quad reused for all tiles.

### Instance buffer
[x, y, tileIndex, state]

---

## Rules

- No per-tile rendering
- No DOM rendering of world
- No per-frame allocations
- Chunk-based batching only

