# Seedscape — Overview

## Vision

Seedscape is an infinite, procedural, tile-based farming simulation built as a **GPU-driven simulation world** rather than a traditional game map.

The world is fully procedural, streamed in chunks, and simulated deterministically.

The internal starting region is **Bloomridge**, a lush agricultural biome where players learn core mechanics.

---

## Core Concept

- Infinite world (chunk-based)
- System-driven farming simulation
- Real-time economy and production chains
- WebGL-first rendering engine
- Worker-driven simulation backend

---

## Design Pillars

### 1. Systemic First
Everything is a rule-based simulation:
- Crop growth
- Economy
- Production
- World generation

No scripted gameplay.

---

### 2. Infinite World
- Chunk-based streaming (32×32 tiles)
- Procedural generation via seed
- No fixed map boundaries

---

### 3. Performance as a Feature
- WebGL2 instanced rendering
- Typed-array memory model
- Worker-based simulation
- No per-tile CPU logic

---

### 4. Emergent Gameplay
Systems interact to produce unexpected outcomes:
- Supply chains
- Resource bottlenecks
- Expansion pressure

---

## World Structure

- Seedscape → entire simulation universe
- Bloomridge → starting biome

