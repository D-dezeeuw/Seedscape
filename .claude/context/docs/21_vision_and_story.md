# Seedscape — Vision & Story

> Companion to [00_overview.md](00_overview.md). Where 00 covers the **technical** vision (GPU-driven, infinite, deterministic), this doc covers the **player** vision: the genre pivot, the narrative hook, and the design pillars that follow from them.

---

## Genre Pivot — God + Embodiment

Seedscape is not "a farming game." It's a **god-style village builder with embodiment**. Two control modes coexist:

| Mode        | Camera     | Input                          | Tool target            |
|-------------|------------|--------------------------------|------------------------|
| **God**     | Free pan   | WASD/arrows pan, mouse clicks  | Tile under cursor      |
| **Possess** | Follow-cam | WASD/arrows move the avatar    | Tile the avatar faces  |

The player **clicks a villager** to possess them and **presses ESC** (or an on-screen exit button) to release back to god view.

This is the core verb of the game: *zoom out and direct, zoom in and embody*. Every action — till, plant, water, harvest, feed, build, dismantle — is reachable from both modes. God mode is for orchestrating the village; possession is for the intimate moments (planting the first seed, baking bread, sitting with a sick chicken).

---

## Story

> A lonely settler wakes after collapsing from exhaustion, with no memory of where they came from or how they got here. The land around them is wild and quiet. To survive, they start a farm — clearing soil, planting seeds, hauling water from the stream.
>
> As food and shelter take shape, others begin to find their way to the settler's patch of land — drawn by the smoke from the chimney, the smell of bread, the simple promise of safety. Each new arrival carries their own story: a baker who lost their oven, a child who ran from somewhere worse, a quiet woman who only speaks to chickens.
>
> Slowly, the farm becomes a village. The settler isn't alone anymore.

The amnesia is the *why* the player has agency: they're rebuilding from scratch with no priors. The loneliness is the *why* every new villager matters. The settler is patient zero — but as the village grows, the player's attention shifts outward, becoming less *the settler* and more *the village's quiet god*.

---

## Design Pillars (revised)

The four pillars from [00_overview.md](00_overview.md) (Systemic First, Infinite World, Performance as a Feature, Emergent Gameplay) still hold. Two new pillars stack on top:

### 5. Embodiment AND Oversight

Every action is available in both modes. No "you must possess to plant" gating — that would punish god-mode play. Possession exists for **flavor and flow**, not because the systems require it. Players who prefer pure-god gameplay should still be able to reach the credits.

What changes between modes is the **friction profile**:
- God mode: high reach, low presence — you can act anywhere on screen but feel detached.
- Possess mode: low reach (one tile per step), high presence — you walk, you watch, you live there for a moment.

### 6. People Are The Soul

NPCs aren't labor units. They're characters with:
- **Memory** — they remember what you did or didn't do for them.
- **Mood** — temporary state that affects work output and dialogue.
- **Personality** — stable traits (likes, dislikes, schedule preferences) that color decisions.
- **Relationships** — to each other and to the settler.

This is the soul of the long game. Crops grow whether you watch or not; villagers' inner lives are why you keep watching. ([18_people_system.md](18_people_system.md) is the technical scaffold for this, currently marked future.)

---

## System Implications

The pivot touches several existing systems. **No code is rewritten today** — this section is a forward map.

### Avatar entity layer
A new render layer above tiles. Each villager (and eventually animal) is an entity with:
- Position (world coords, not tile-snapped — sub-tile floats)
- Facing direction (4 cardinal minimum; 8 if we want diagonals)
- Animation state (idle / walk / action)
- A reference to the persistent character record (memory, mood, relationships)

Same scaffold as the NPC people-sim ([18_people_system.md](18_people_system.md)) — possession is "the player temporarily drives this entity instead of the AI."

### Camera modes
- **God mode** = today's free camera, unchanged.
- **Possess mode** = follow-cam centered on the avatar. Smooth follow with a small dead-zone so micro-movements don't jitter the camera. Edge-scroll behavior (LttP-style) is *not* needed — follow-cam already keeps the avatar centered.
- Mode switch is a single state flag. Movement input routes to camera (god) or avatar (possess).

### Tool targeting
- **God mode**: target = tile under mouse cursor (current behavior).
- **Possess mode**: target = tile in front of the avatar (avatar tile + facing offset).
- The same tool actions (`till`, `plant`, `water`, `harvest`, `build`, `feed`, `dismantle`) work identically. Only the targeting layer differs.

### Save / load
- Persistent: avatar position, facing, current control mode (so reload restores possession).
- Per-villager: memory, mood, relationships (eventually). Phase 5 ships only the settler; multi-villager state is later.

### UI
- Bottom-right "Exit possession" button mirrors ESC, for touch users.
- Tool palette stays the same. Build menu stays the same.
- The cursor disappears in possess mode (no mouse-targeted tools); a small reticle appears on the faced tile.

---

## What This Replaces / Defers

The previous Phase 5 ("Expansion + Polish") was a grab-bag of biome additions, advanced production, multiplayer, and mobile input. The pivot **inserts an avatar phase before that**, and Phase 5's old contents shift to Phase 6+.

The deferred Phase 3.5 (animals + people sim) gains weight: once possession exists, having only one possessable entity (the settler) is thin. Phase 3.5 should land soon after the avatar phase so possession has more than one target.

---

## Open Questions

Decisions to make before implementation begins. Not blocking this doc, but blocking the phase scope.

1. **Movement style** — tile-snap (LttP outdoor) or smooth sub-tile (Stardew)? Smooth feels better for a living-world game; snap is simpler to collide and animate.
2. **Walking speed** — tiles per second when walking. Likely 3–5.
3. **Collision rules** — water blocks (yes). Crops? (probably walkable, no trample mechanic.) Tilled soil? (walkable.) Buildings? (block.) Other villagers? (soft-collide / push-through.)
4. **Animal possession** — possessable, or only humans? Possessing a chicken is funny but distracting; deferring is fine.
5. **Avatar vitals** — does the settler need to sleep/eat to function, or are needs only on AI-driven villagers? MVP answer: no vitals on the player avatar; vitals belong to AI villagers in the people sim.
6. **God-mode acts vs avatar location** — when the player tills a tile in god mode while possessing, does the avatar walk over to do it, or does it "just happen"? MVP answer: acts apply instantly — god mode is god mode regardless of which entity is possessed.
7. **Release behavior** — on ESC, does the avatar stay where they are (and the AI takes over), or auto-walk home? MVP: stay in place.
8. **Multiple possessables** — can you possess any villager, or only the original settler? MVP: only the settler. Open the rest in a later phase once the AI for unattended villagers is in.

---

## Tone

The game is **quiet, warm, and slow**. Not a survival sim with tension and threat. Not a city-builder with optimization pressure. The dominant feeling is *settling in*: a small place getting a little more lived-in each day, with people you've gotten to know.

Combat: none. Hostile mobs: none. Failure states: minimal — crops wilt if forgotten, villagers grumble if neglected, but nothing dies and nothing is lost permanently. The genre this most resembles is **cozy management** (Stardew, Animal Crossing, A Short Hike) layered over a god game (Black & White's intimacy without the cruelty).
