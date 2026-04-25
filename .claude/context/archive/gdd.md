
# Seedscape — Game Design Document (GDD)

## 1. Vision Statement

Seedscape is an infinite, procedural, tile-based farming and management simulation where players build and optimize living agricultural systems across expanding biomes.

The world is not handcrafted — it is simulated.

The internal starter biome is **Bloomridge**, a lush agricultural valley where players learn core systems.

---

## 2. Design Pillars

### 2.1 Systemic Simulation First
Everything in Seedscape is driven by deterministic systems:
- Crop growth is formula-based
- Economy is rule-based
- World generation is seed-driven

No scripted gameplay loops.

---

### 2.2 Infinite Expandable World
- Chunk-based infinite terrain
- Procedural biome generation
- No hard map boundaries

---

### 2.3 Minimal UI, High Depth
- Simple surface interaction
- Deep backend simulation layers
- Emergent complexity over time

---

### 2.4 Performance-Constrained Design
- GPU-first rendering (WebGL2)
- Worker-based simulation
- Typed-array memory model
- Chunk-level streaming only

---

## 3. Core Gameplay Loop

### Primary Loop

1. Plant crops
2. Wait (real-time growth)
3. Harvest
4. Process into goods
5. Sell / fulfill orders
6. Expand farm

---

## 4. Game Systems

## 4.1 Farming System

### Crop Lifecycle
- Seed → Growth Stage 1 → 2 → 3 → Harvest → Withered

### Parameters
- Growth time (seconds)
- Water dependency
- Fertilizer modifiers
- Biome effects

---

## 4.2 Production System

Buildings convert raw goods:

- Mill → Flour
- Bakery → Bread
- Dairy → Cheese

Each building:
- Queue-based processing
- Time-based completion
- Upgradeable efficiency

---

## 4.3 Economy System

### Currencies
- Coins (soft currency)
- Premium tokens (future expansion)

### Income Sources
- Crop sales
- NPC orders
- Production goods

### Sink Systems
- Expansion costs
- Building upgrades
- Speed-ups (optional)

---

## 4.4 Expansion System

Players unlock new chunks:

- Fog-of-war world expansion
- Increasing cost curve
- Biome transitions

---

## 4.5 NPC Order System

- Dynamic order generation
- Weighted item demand
- Reward scaling based on rarity

---

## 4.6 Animal System

- Feeding cycle
- Production outputs (milk, eggs, wool)
- Happiness affects output rate

---

## 4.7 Inventory System

- Slot-based or weight-based hybrid
- Stackable items
- Upgradeable capacity

---

## 5. World Design

## 5.1 Structure

- Seedscape = universe
- Bloomridge = starter biome

---

## 5.2 Biome Types (planned)

- Bloomridge (starter farmland)
- Stoneveil Highlands (rocky farming constraints)
- Sunfen Delta (water-heavy agriculture)
- Voidsoil Expanse (late-game synthetic farming)

---

## 5.3 Procedural Generation

- Seed-based RNG
- Noise functions for terrain variation
- Biome mapping by temperature/moisture fields

---

## 6. Progression System

## 6.1 Player Progression

- XP system
- Unlock tiers:
  - Crops
  - Buildings
  - Systems (automation, trade)

---

## 6.2 Soft Difficulty Curve

- Early: fast feedback loops
- Mid: production chains
- Late: optimization + scale management

---

## 7. Core Game Loops

### Idle Loop
- Offline crop growth

### Optimization Loop
- Min/max production chains

### Expansion Loop
- Unlock new chunks/biomes

### Economy Loop
- Fulfill demand cycles

---

## 8. UI/UX Design

### Principles
- Minimal UI overlay
- World-first interaction
- Context-sensitive panels

### Interaction Model
- Click tile → context actions
- Drag camera → world navigation
- Hover → info overlays

---

## 9. Technical Design Alignment

### Rendering
- WebGL2 instanced rendering
- Texture atlas system
- Chunk-level mesh caching

### Simulation
- Fixed timestep (5–20 TPS)
- Worker-based systems

### Data Model
- Typed arrays (Uint16/Uint8)
- Chunk-based state containers

---

## 10. Performance Design Rules

- No per-tile objects
- No DOM-based world rendering
- No per-frame allocations
- GPU batching mandatory
- Chunk culling required

---

## 11. Multiplayer (Future Phase)

- Server authoritative simulation
- Chunk delta synchronization
- Event-based updates

---

## 12. Risk Analysis

### Performance Risks
- Too many active chunks
- GPU upload overhead
- Simulation bottlenecks

### Mitigation
- LRU chunk cache
- Worker offloading
- Instanced rendering

---

## 13. Unique Selling Proposition

Seedscape differentiates by:

- Fully infinite simulation world
- No handcrafted map design
- System-driven farming economy
- Browser-native high-performance engine
- Emergent gameplay over scripted content

---

## 14. Summary

Seedscape is a scalable simulation platform disguised as a farming game. Its core innovation lies in treating agriculture, economy, and world generation as unified deterministic systems rather than isolated gameplay features.

Bloomridge is the entry point into this system.
