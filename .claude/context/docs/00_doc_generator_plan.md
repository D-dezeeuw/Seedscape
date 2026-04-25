📁 Recommended Documentation Set (Seedscape)
1. Core Product Definition
00_overview.md

Purpose: Single source of truth for what Seedscape is

Includes:

Vision (Seedscape + Bloomridge framing)
One-paragraph pitch
Core pillars
Target player experience
High-level feature summary
01_game_design.md

Purpose: Human-readable game rules (your current GDD base)

Includes:

Core gameplay loops
Farming systems
Economy
Progression
Biomes
Player goals
2. Technical Architecture
02_engine_spec.md

Purpose: WebGL + simulation engine contract

Includes:

Rendering pipeline
Chunk system
Worker system
Memory model
Shader architecture
Performance constraints

(You already have this one effectively defined.)

03_world_simulation.md

Purpose: Deterministic simulation rules (shared logic layer)

Includes:

Crop growth formulas
Production rules
Economy balancing rules
RNG + seed system
Tick system design
System interactions

👉 This is the “truth engine” of the game.

04_rendering_pipeline.md

Purpose: GPU execution model

Includes:

Instanced rendering design
Texture atlas rules
Chunk mesh generation
Camera transforms
Shader contracts
GPU buffer lifecycle
3. Data & Memory Systems
05_data_model.md

Purpose: Defines all runtime structures

Includes:

Chunk format (CPU)
Tile encoding (bit layout / typed arrays)
Entity format
Save format
Network sync format (future)
06_memory_performance.md

Purpose: Performance constraints + benchmarks

Includes:

Chunk memory budget
GPU memory limits
Cache strategies (LRU rules)
Worker throughput expectations
GC avoidance rules
4. World & Content Design
07_world_generation.md

Purpose: Procedural world logic

Includes:

Seed system
Noise functions
Biome generation rules
Bloomridge definition
Future biome templates
08_biomes.md

Purpose: Content layer for world diversity

Includes:

Bloomridge (starter biome)
Stoneveil Highlands
Sunfen Delta
Voidsoil Expanse

Each biome defines:

Visual rules
Resource distribution
Gameplay modifiers
5. Gameplay Systems
09_farming_system.md

Purpose: Crop lifecycle + farming mechanics

Includes:

Growth stages
Time formulas
Water/fertilizer effects
Harvest logic
10_economy_system.md

Purpose: All currency + trading logic

Includes:

Coin flow
NPC demand system
Pricing logic
Inflation control rules
11_production_system.md

Purpose: Crafting chains

Includes:

Building definitions
Input/output rules
Queue system
Upgrade scaling
12_progression_system.md

Purpose: Player advancement

Includes:

XP system
Unlock curves
Difficulty scaling
Soft gating mechanics
6. Engine Implementation Planning
13_chunk_lifecycle.md

Purpose: Deep dive into chunk state machine

Includes:

Load → Generate → Simulate → Render → Evict
Dirty flags
Sync rules
Worker interaction
14_worker_architecture.md

Purpose: Multithreading model

Includes:

Worker pool design
Task scheduling
Message formats
Determinism constraints
15_rendering_shaders.md

Purpose: Full shader contract documentation

Includes:

Vertex shader responsibilities
Fragment shader logic
Atlas UV mapping rules
Animation hooks
Lighting system (optional)
7. Networking (Future-Proofing)
16_networking_model.md

Purpose: Multiplayer design (even if not implemented yet)

Includes:

Chunk sync model
Delta updates
Event-based system
Authority rules (server vs client)
8. Production Planning
17_mvp_scope.md

Purpose: Strict minimal version definition

Includes:

What MUST exist for first playable version
What is explicitly excluded
First 2–4 week build plan
“Definition of playable Seedscape”
18_roadmap.md

Purpose: Development phases

Includes:

Phase 1: Rendering prototype
Phase 2: Chunk system
Phase 3: Farming loop
Phase 4: Economy + production
Phase 5: Expansion + polish