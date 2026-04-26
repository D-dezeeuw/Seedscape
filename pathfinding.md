# Large-Scale Entity Pathfinding Architecture (JavaScript / Web Workers)

## 1. Overview

This document describes a high-performance pathfinding system for a large number of entities navigating a tile-based world with dynamic obstacles (water, buildings, blocked tiles). The system is designed for browser-based environments using JavaScript, Web Workers, and optimized grid pathfinding techniques.

The primary goals:

- Support **hundreds to thousands of entities**
- Handle **dynamic obstacles**
- Maintain **low main-thread overhead**
- Scale across **large tile maps**
- Support both **static and dynamic path recalculation**

---

## 2. Core Design Principles

### 2.1 Separation of Concerns

- Main thread:
  - Entity simulation
  - Rendering
  - High-level path requests

- Web Workers:
  - Pathfinding computation
  - Map preprocessing
  - Flow-field generation (optional)

---

### 2.2 Data-Oriented Design

Avoid object-heavy structures:

- Use `TypedArray` (Uint8Array, Uint16Array, Float32Array)
- Use flat grid indexing:
  - `index = x + y * width`
- Avoid per-node objects entirely

---

## 3. World Representation

### 3.1 Tile Grid

Each tile stores:

- Walkable (0/1)
- Movement cost (terrain)
- Dynamic blockage flag (units/buildings/water changes)

Example structures:

```js
Uint8Array walkable;
Uint8Array terrainCost;
Uint8Array dynamicBlocked;
```

Effective traversal cost:

```js
cost = terrainCost + dynamicPenalty
if (!walkable || dynamicBlocked) => blocked
```

### 3.2 Chunking Strategy

To scale large maps:

Divide world into fixed chunks (e.g. 64×64 tiles)
Track dirty chunks
Recompute only affected regions

Benefits:

- localized recomputation
- cache-friendly memory access
- parallel worker updates

## 4. Pathfinding Strategy

Use a hybrid approach depending on situation.

### 4.1 Base Algorithm: Optimized A*

Core optimizations:

- Binary heap priority queue
- Flat arrays for:
- gScore
- fScore
- visited flags
- No recursion
- Precomputed neighbor offsets

Heuristic:

Manhattan distance (grid-based movement)

### 4.2 Jump Point Search (JPS)

Best for:

- open maps
- uniform-cost grids

Advantages:

- skips intermediate nodes
- reduces search space dramatically

Limitations:

- weaker in dense obstacle environments
- more complex implementation

### 4.3 Hierarchical Pathfinding (HPA*)

Approach:

- Split map into clusters
- Build abstract graph of cluster entrances
- Run A* on macro graph
- Refine within clusters

Best for:

- large worlds
- long-distance navigation

### 4.4 Flow Fields (Group Movement)

For large groups targeting same destination:

- Compute reverse cost field from target
- Each tile stores direction to best neighbor
- Entities follow gradient

Best for:

- RTS units
- crowds
- swarms

## 5. Web Worker Architecture

### 5.1 Worker Pool

Create a fixed pool:

```js
const workers = Array.from({ length: navigator.hardwareConcurrency }, () =>
  new Worker("pathworker.js")
);
```

Use:

 - round-robin scheduling OR
 - job queue balancing

### 5.2 Job Types

Workers handle:

- single path request (A* / JPS)
- batch path requests
- flow field generation
- replanning after map changes


### 5.3 Message Protocol

Request:

```js
{
  type: "PATH_REQUEST",
  entityId: 123,
  start: [x, y],
  goal: [x, y],
  gridVersion: 42
}
```

Reponse:

```js
{
  type: "PATH_RESULT",
  entityId: 123,
  path: [[x,y],[x,y],...]
}
```

## 6. Dynamic Obstacles

### 6.1 Dirty Chunk System

When environment changes:

- mark affected chunks dirty
- invalidate cached paths in region
- recompute locally only

### 6.2 Incremental Replanning

Instead of full recomputation:

- reuse prefix of valid path
- recompute from divergence point

### 6.3 Reservation System (Optional)

To prevent collisions:

- reserve tiles per timestep
- enforce time-based occupancy grid

Useful for:

- tight corridors
- RTS congestion

## 7. Performance Optimization

### 7.1 Memory Strategy

- preallocate all arrays
- reuse buffers
- avoid object creation in hot loops

### 7.2 Compute Optimization

- binary heap open set
- bitset for closed nodes
- inline neighbor iteration
- avoid function calls in loops

### 7.3 Batch Processing

Instead of immediate computation:

- queue path requests
- process in worker batches (e.g. 20–100 per tick)

7.4 Caching Layer

Cache:

(start, goal, gridVersion) → path

Invalidate when:

- chunk changes
- dynamic obstacle changes

## 8. Entity Movement System

Entities:

- follow path step-by-step
- consume waypoints
- request new path when:
- path exhausted
- blocked
- target moved significantly

Optional smoothing:

- steering interpolation
- local avoidance layer

## 9. Recommended Hybrid Stack

Best production setup:

- Small-scale (precision movement)
- A* + binary heap + workers
- Dense crowds
- Flow fields
- Large world navigation
- HPA* + A*
- Open areas
- JPS

## 10. Scalability Targets

This architecture supports:

- 1,000–10,000 entities (depending on update rate)
- 100–500 path requests/sec (worker distributed)
- large maps via chunk streaming (10k × 10k+)

## 11. Future Improvements

- WebGPU pathfinding acceleration
- GPU flow-field generation
- predictive caching based on entity velocity
- multi-agent collision prediction system
- adaptive LOD pathfinding (distance-based simplification)

## 12. Summary

The optimal system is layered:

- A* / JPS → precise routing
- Flow fields → group movement
- HPA* → large-scale abstraction
- Web Workers → parallel execution
- TypedArrays → memory efficiency