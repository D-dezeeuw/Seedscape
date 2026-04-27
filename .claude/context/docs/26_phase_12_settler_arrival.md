# Seedscape — Phase 12: Settler Arrival & Village Identity

> The story payoff. Phase 10 made settlers feel alive; Phase 12 makes their *arrival* meaningful. The lonely settler stops being lonely as new villagers find the farm — drawn by smoke, bread, and shelter — each carrying their own backstory.

## Goal

Three layers, all rooted in [21_vision_and_story.md](21_vision_and_story.md):
1. **Arrival mechanic** — village state (food surplus, housing capacity, smoke output) determines whether new villagers can find the farm. The world becomes a soft probability gate.
2. **Character generation** — every arriving villager has a procedural backstory, traits, likes, and dislikes. They're not interchangeable.
3. **Village identity** — relationships, memory of player actions, and small narrative beats turn a labor pool into a community.

After Phase 12, the game has its core long-tail emotional hook. Future phases can layer breadth (more biomes, more crops) but the soul is in.

## Why now

- Phase 10 needs (settlers eating + sleeping) plus Phase 11 economy (food trade) feed Phase 12: a village can be measured as "viable" or "struggling," and arrivals respond.
- The story arc described in [21_vision_and_story.md](21_vision_and_story.md) — the lonely settler welcoming others — only lands when arrivals feel earned.
- Sets the scaffolding for any future narrative: relationships, gifts, dialogue, conflict.
- Risk-bounded: most of the work is data-driven (trait JSON, backstory templates) so iteration is cheap.

## Scope

### Arrival trigger

Village viability score per settlement, recomputed each in-game day:
- **Food surplus** = food stored / settlers × 0.4
- **Housing surplus** = unassigned beds × 0.3
- **Activity signal** = sum of building cycles run today × 0.2 (the "smoke" proxy)
- **Population factor** = 1 / (1 + e^(0.1 × population)) — slows arrivals as village grows so it doesn't snowball

Arrival probability per day = `clamp(0, viability × 0.5, 0.4)`. Roll once per game day.

On a successful roll: a new villager appears at the world edge of the loaded chunk region and walks toward the village. Player notification toast: "Someone new is approaching."

### Character generation

Procedural villager build:
- **Name + gender** — already exists ([src/state/entities/names.ts](../../../src/state/entities/names.ts)).
- **Backstory tag** — seeded pick from a JSON list (`data/backstories.json`): "the baker who lost their oven," "the runaway child," "the quiet woman who only speaks to chickens." 20–30 templates for variety.
- **Traits** — 8-bit packed; existing field. Define meaningful trait flags: `LIKES_ANIMALS`, `DISLIKES_CROWDS`, `EARLY_RISER`, `HEAVY_SLEEPER`, `GLUTTON`, etc.
- **Skill multipliers** — derived from traits. EARLY_RISER restores sleep faster at dawn; GLUTTON eats more meals.
- **Stat variance** — base needs spread by ±10% per villager so they don't all hit critical at once.

Backstory affects starting offer: arriving with own item ("the baker brings 5 wheat"), starting need bias ("the runaway child arrives malnourished — hunger 30%"), or trait reveal ("she only socializes with chickens — social need restored by being near pens").

### Relationships

- Pairwise relationship state per villager pair: `friendship: i8` (-128 to 127), updated daily based on:
  - Time spent within social radius
  - Trait compatibility (LIKES_ANIMALS + DISLIKES_ANIMALS = friction)
  - Witnessed events (one villager rescued from collapse by another → +20)
- Person window adds "Relationships" section listing top 3 friends + worst rival.
- High-friendship pairs work faster when assigned the same job; rivals slower.

### Player memory

Each villager tracks the player's recent actions:
- `playerHelped: u32` — count of player actions that benefited this villager (fed them, built their bed, harvested for them while they were sleeping)
- `playerNeglected: u32` — counter for opposite (let them collapse, dismantled their bed, stole produce mid-haul)
- Affects mood baseline + dialogue tone (when dialogue ships — Phase 13+).

### Welcome Hall building

- New tile id 256.
- Acts as a village "hub." Arriving villagers walk to the Welcome Hall first (if one exists) before settling in.
- Optional in Phase 12 (arrivals work without it; the Hall just adds a narrative beat).
- Building window for the Hall lists recent arrivals + their backstories — a "village log" the player can revisit.

### First-arrival scripted event

The very first non-spawn villager triggers a one-shot scripted toast:

> "Someone has come to the smoke from your chimney. Their name is [Name]. They say they were [backstory]."

Marks the moment the village is no longer just the player. Uses normal arrival mechanic — just gates first-arrival on a separate "first" flag.

### UI

- Toast: arrival announcements with the new villager's backstory tag.
- Person window: backstory line above identity, relationships section.
- Settlers list: small backstory icon next to the name.
- Welcome Hall window (optional): arrival log.

## Out of scope

- Dialogue system — characters have backstories but don't speak. Dialogue is Phase 13+.
- Romance / marriage / family — relationships are platonic-friendship only; romance is its own design pass.
- Death + grief — settlers can collapse (Phase 10) but don't die. Death + grief mechanics are Phase 13+.
- Settler departure — once arrived, settlers stay. Voluntary leaving is later.
- Multi-village support — single settlement only.
- Faction / reputation systems beyond pairwise friendship.

## Data shape changes

- **New tile id:** 256 (Welcome Hall).
- **New JSON file:** [data/backstories.json](../../../data/backstories.json) — 20–30 backstory templates with name pools, trait biases, starting bias, optional starting items.
- **`Villager` extension:** `backstoryId: u8`, `playerHelped: u32`, `playerNeglected: u32`, `arrivedTick: u32`, `firstArrival: bool`.
- **Relationship matrix:** sparse `Map<(idA<<32)|idB, i8>` — only stored for actual interactions; missing entries default to neutral 0.
- **Save migration:** SAVE_VERSION 13 → 14. Adds villager backstory fields, the relationship matrix, and the village viability score (cached for cross-day continuity).

## Open questions (decide before kickoff)

1. **Arrival cadence** — one villager per day max feels right; faster cadence (multiple per day) risks the village exploding too fast. Lock to one max.
2. **First-arrival timing** — should the very first arrival be guaranteed within the first few in-game days regardless of viability? Recommend yes; otherwise the narrative beat may never trigger.
3. **Relationship tick cost** — pairwise update is O(N²). At expected village sizes (≤20 in playtest), trivial. Set ceiling early to avoid surprises.
4. **Backstory persistence on rename** — if a player renames a villager, does the backstory tag still apply? Recommend yes; backstory is fixed at arrival.
5. **Welcome Hall: optional or required?** — recommend optional. Arrivals work without it; building one just makes the narrative beat richer.
6. **Player memory granularity** — do we track per-action types (fed=+1, neglected=+1) or weighted scores? Start with two counters; weighted scores can come later.

## Exit criteria

> Player runs a viable village (food surplus, beds for everyone) for ~2 in-game days. A new villager arrives at the world edge, walks to the village (or Welcome Hall), introduces themselves via toast with a procedural backstory. Open the Person window: the backstory shows above the identity block, the trait flags reflect the backstory's bias, the starting needs match the backstory (the runaway child arrives hungry). After a few in-game days, the new villager has a measurable friendship/rivalry with at least one existing settler. Save/reload preserves backstories, relationships, and arrival history.

## Estimated effort

~10–14 days. Arrival mechanic + viability score: ~2 days. Character generation + backstory JSON + traits: ~3 days. Relationships + memory: ~3 days. Welcome Hall + UI polish: ~2 days. Tuning + first-arrival scripted event: ~2 days.

## References

- [21_vision_and_story.md](21_vision_and_story.md) — narrative arc this phase delivers
- [18_people_system.md](18_people_system.md) — Person model that backstories extend
- [24_phase_10_people_simulation.md](24_phase_10_people_simulation.md) — the needs scaffolding Phase 12 reads
- [25_phase_11_dynamic_economy.md](25_phase_11_dynamic_economy.md) — viability score depends on food surplus from Phase 11's economy
