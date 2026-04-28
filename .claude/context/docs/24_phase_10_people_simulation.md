# Seedscape — Phase 10: People Simulation (Needs, Sleep, Eat)

> The vision pillar "People Are The Soul" goes from a doc to a runtime feature. Settlers stop being stateless labor units and become entities with biological needs, daily rhythms, and consequences for neglect.
>
> **Phase split:**
>
> - **10.1 (shipped):** Hunger only. `LivingEntity.needs.hunger` decays per sim tick (~10 min from full to dead). Idle hungry settlers walk to the nearest crate holding any food item (carrot / corn / bread / egg) and eat one unit. Hitting 0 = death — entity removed + toast. Person window has a coloured hunger bar.
> - **10.2 (next):** Sleep + day cycle + Bed/Kitchen/Table/Toilet buildings. Mood derived from all needs. Mid-job pre-emption (`eat`/`sleep`/`relieve` tasks interrupt running jobs).
> - **10.3:** Trait modifiers + work-speed multipliers, foundation for Phase 12 personality / arrival.

## Goal

Settlers run on a 6-need vector that decays over time and is restored by interacting with specific buildings. A day/night phase boundary modifies decay rates and gates the sleep cycle. The player must build housing (beds), a kitchen, and a toilet — or settlers' mood/work output collapses.

This is the largest scoped phase since 7. It establishes scaffolding (day cycle, need bars, mood) that Phase 12 (settler arrival) and any future relationship/social work will reuse.

## Why now

- The story pillar — "lonely settler welcomes others to a place that feels safe" — only lands when villagers visibly care about food/shelter. Without needs, every settler is the same forever.
- All later content (relationships, mood, schedules, arrivals) depends on this scaffold.
- The spec is already mostly written in [18_people_system.md](18_people_system.md) — Phase 10 implements the MVP slice of that doc.
- Triggers natural follow-on phases: Phase 11 (food demand spikes prices), Phase 12 (housing capacity gates arrivals).

## Scope

### Need vector

- 6 `Uint8` needs per `LivingEntity` (not just Villager — animals already have a hunger; this generalizes).
- Per-need decay rate (per sim tick) — see table in [18_people_system.md](18_people_system.md#needs-system).
- Per-need restore action: hunger → eat at table, sleep → sleep in bed (night only), toilet → use toilet, cleanliness → bathe, social → be near another villager (radius 3), mood → derived.
- Critical state at need = 0: forced behavior override (e.g., toilet 0 forces a "find toilet now" task that pre-empts the current job).

### Day cycle

- 1440 sim ticks/day (matches doc default — at 10 TPS, 2.4 min real-time per game day).
- 4 phases derived from `tick % 1440`: Dawn / Day / Dusk / Night (boundaries per [18_people_system.md](18_people_system.md#day-cycle)).
- Phase boundary modifies decay/restore rates (sleep restores only at night, social rises only during day, etc.).
- A small day/night tint over the canvas (no full lighting system yet — that's a polish phase).
- HUD shows current day number + phase indicator.

### Buildings

Three new building tiles in range 240–249:

- **Bed** (240): single-occupancy. Owned by a specific villager (assigned on placement or first use). Sleep need restores when occupied at night.
- **Kitchen** (241): consumes one food item from input buffer per "meal." Produces a "meal" output that fills hunger when eaten at table.
- **Table** (242): adjacent-tile interaction point. Settlers walk to a table, consume a meal, hunger restores.
- **Toilet** (243): toilet need restores on use. One occupant at a time; queue managed via job claim mutex (existing system).

### New tasks

Mid-job interrupts via the existing `taskStack` (Phase 7.5):

- `eat` — when hunger < 30%, inject. Pulls a meal from a kitchen output buffer (auto-emitted by job board) or directly consumes a raw edible item carried.
- `sleep` — when night phase begins AND sleep < 70%, inject. Walks to assigned bed.
- `relieve` — when toilet < 20%, inject. Walks to nearest toilet.
- `bathe` — when cleanliness < 30%, inject (lower priority — only at idle, not mid-job).

Task priorities (highest wins): `relieve > eat > sleep > deposit (existing) > job (existing) > bathe > idle wander`.

### Mood + work output

- Mood derived from other needs per the formula in [18_people_system.md](18_people_system.md#mood-formula).
- Mood modifies work speed: settlers at low mood take longer to complete `actAtTarget` (multiplied tick budget). Threshold-based, not continuous, to keep the sim deterministic and cheap.
- No dialogue / social effects yet — those are post-Phase 12.

### UI

- Person window: needs bars (6 stacked horizontal bars with thresholds marked).
- HUD: day counter + phase icon (☀ ☾).
- Toast: critical-need warnings ("Anika collapsed from hunger") so the player notices before settlers die.
- Building window for kitchen: meal recipe + queue, mirroring Mill/Bakery.

## Out of scope

- Settler death — Phase 10 ships "collapse" (becomes idle, mood crashes) but no permanent death. Death + grief lands in Phase 12 alongside the relationship system.
- Personality traits — needs are universal in Phase 10. Per-villager trait modifiers (this one needs less sleep, that one is grumpy) are Phase 12.
- Schedules / shift assignment — settlers self-schedule based on needs; no manual "you work nights" UI.
- Multi-meal cuisine — kitchen produces a single generic "meal" item from any raw food input. Recipe variety is later.
- Lighting / day-night visuals beyond a tint — full lighting is a polish phase.
- Social circles / relationships — solitary/social need decay only; no pairwise edges yet.

## Data shape changes

- **Tile ids:** 240 (Bed), 241 (Kitchen), 242 (Table), 243 (Toilet).
- **New items:** `meal` (id 730) — generic prepared food from kitchen.
- **Save migration:** SAVE_VERSION 11 → 12. Per-villager `needs: Uint8Array(6)`, `bedAssigned: tileXY | null`, `lastEatTick: u32`. Bed-ownership map: `bedOwners: Record<tileKey, villagerId>`.
- **Sim worker:** day-phase computation moves to the worker (deterministic from tick number). Worker emits phase-transition events the main thread listens to for UI tint.

## Open questions (decide before kickoff)

1. **Bed assignment** — assigned-on-placement (player paints a bed for a specific villager) or first-come (whoever sleeps there first owns it)? Recommend first-come with a manual reassign in the Person window.
2. **Need decay rates** — [18_people_system.md](18_people_system.md) lists rates per tick; at 10 TPS those numbers feel fast. Tune so a fully-rested settler stays fed/rested for ~half a game day without intervention.
3. **Critical-need pre-emption** — interrupt a settler mid-job (drop everything, run to toilet) or wait for next idle? Recommend interrupt with a small failure penalty (the abandoned job re-emits with a small backoff).
4. **Mood-as-multiplier granularity** — 3 buckets (bad/ok/good) or continuous? Buckets are cheaper and easier to telegraph in UI.
5. **Animal hunger reuse** — do animals (Phase 9) share the 6-need vector, or stay on their single hunger field? Recommend a single shared vector; animals just leave 5 fields unused.

## Exit criteria

> Spawn a settler. Build a bed, kitchen with food in its input buffer, table, and toilet. Without further input: settler works during the day, eats at the table when hungry, uses the toilet when needed, walks to the bed at dusk, sleeps through the night, wakes at dawn, and resumes work. Skip building any of the four — the relevant need crashes, the settler's mood drops, and a toast warns the player. Save/reload restores all needs, the day-phase tick, and bed assignments.

## Estimated effort

~14–18 days. The need vector + tick-driven decay + day phase is ~3 days; the four buildings + their job emitters are ~2 days each (~8 days); UI and tuning is ~3–5 days.

## References

- [18_people_system.md](18_people_system.md) — full spec; Phase 10 implements the MVP slice
- [22_pathfinding.md](22_pathfinding.md) — taskStack used for need-driven interrupts
- [21_vision_and_story.md](21_vision_and_story.md) — narrative pillar this phase lands
- [11_production_system.md](11_production_system.md) — kitchen reuses building queue model
