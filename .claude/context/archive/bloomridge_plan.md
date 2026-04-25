# Seedscape --- Infinite Tile-Based Farm Simulation

## Overview

Seedscape is a browser-based, infinite tile simulation game inspired by
farming and management games (e.g. Hay Day, FarmVille), built around a
**procedural, chunked world system**. The world contains infinite
terrain streamed via WebGL rendering and Web Worker-driven simulation.

The internal world setting is **Bloomridge**, the starter biome.

------------------------------------------------------------------------

# 1. High-Level Architecture

## System Layers

-   **Client (Browser)**
    -   WebGL rendering
    -   Input handling
    -   Chunk streaming
    -   UI layer
    -   Worker orchestration
-   **Server (Node.js)**
    -   Authoritative simulation
    -   Persistence layer
    -   Multiplayer sync (optional phase)
-   **Shared**
    -   Deterministic simulation logic
    -   World generation
    -   Constants and data models

------------------------------------------------------------------------

# 2. Core Technical Design

## Chunk System

-   Chunk size: 32×32 tiles
-   Infinite world via procedural generation
-   Only visible chunks are loaded
-   LRU cache for memory control

### Chunk Lifecycle

1.  Request chunk
2.  Generate (worker)
3.  Cache
4.  Render via GPU instancing
5.  Evict when far

------------------------------------------------------------------------

## Data Model

### Tile (CPU)

-   Uint16Array (tileId)
-   Uint8Array (state)
-   Uint8Array (metadata)

### Tile (GPU)

-   Instanced buffer:
    -   position
    -   tile index
    -   state flags

------------------------------------------------------------------------

## Memory Strategy (Benchmark Summary)

  Model           Memory   Speed   Verdict
  --------------- -------- ------- ---------------
  Objects         High     Slow    ❌ Not viable
  Typed Arrays    Low      Fast    ✅ Baseline
  Packed Uint32   Lowest   Fast    🏆 Best

------------------------------------------------------------------------

# 3. Rendering System (WebGL2)

## Pipeline

1.  Determine visible chunks
2.  Build/refresh instance buffers
3.  Bind texture atlas
4.  Draw instanced tiles

## Shader Model

-   Vertex shader:
    -   transforms tile positions
    -   computes atlas UVs
-   Fragment shader:
    -   samples atlas texture
    -   applies state-based effects

## Key Optimizations

-   Instanced rendering
-   Texture atlas batching
-   Chunk-level GPU buffers
-   No per-tile draw calls

------------------------------------------------------------------------

# 4. Worker Architecture

## Responsibilities

-   Chunk generation
-   Simulation ticks
-   Mesh preparation

## Rule

Workers are: - Stateless - Pure input/output systems

------------------------------------------------------------------------

# 5. Simulation Design

## Game Loop Types

-   Fixed tick simulation (5--20 TPS)
-   Render loop (60 FPS)
-   Async IO loop

## Core Loops

-   Crop growth
-   Production chains
-   Economy flow
-   Expansion unlocks

------------------------------------------------------------------------

# 6. Feature System (Farm Simulation)

## Core Loop

Plant → Grow → Harvest → Process → Sell → Expand

## Systems

-   Crops (growth stages)
-   Production buildings
-   Inventory system
-   NPC orders
-   Economy progression
-   Animal systems
-   Decoration layer
-   Expansion unlocks

------------------------------------------------------------------------

# 7. World Design

## Structure

-   Seedscape = universe
-   Bloomridge = starting biome

## Future Biomes

-   Stoneveil Highlands
-   Sunfen Delta
-   Voidsoil Expanse

------------------------------------------------------------------------

# 8. Naming System

## Final Choice

-   Game: Seedscape
-   Internal world: Bloomridge

## Rationale

-   Seedscape: unique, scalable, system-like
-   Bloomridge: cozy starter region identity

------------------------------------------------------------------------

# 9. Folder Architecture

## Client

-   core/
-   rendering/
-   world/
-   workers/
-   input/
-   state/
-   net/
-   ui/

## Server

-   core/
-   world/
-   simulation/
-   persistence/
-   net/

## Shared

-   world/
-   simulation/
-   constants/
-   utils/

------------------------------------------------------------------------

# 10. Networking Model (Future)

-   Chunk-based sync
-   Delta updates only
-   Event-driven replication

------------------------------------------------------------------------

# 11. Performance Strategy

-   Typed arrays over objects
-   GPU instancing
-   Chunk culling
-   Worker-based simulation
-   LRU chunk caching
-   Minimal GC pressure

------------------------------------------------------------------------

# 12. Key Design Principle

> Everything revolves around chunks as the atomic unit of simulation,
> rendering, and networking.

------------------------------------------------------------------------

# 13. Vision

Seedscape is designed as a scalable, infinite simulation platform where
farming systems emerge from deterministic world simulation rather than
scripted gameplay.

Bloomridge is the first expression of this system.
