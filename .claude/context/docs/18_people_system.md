# Seedscape — People System

## Principle

People are autonomous entities that live and work on the farm. Their behavior emerges from need decay, mood state, and memory — not scripted routines. Like everything else in Seedscape, the simulation is deterministic and tick-driven.

> Phase: Post-MVP. Specified here so the entity system, day cycle, and tick scheduler don't preclude it.

---

## Entity Model

People extend the base entity format from [05_data_model.md](05_data_model.md). They live outside the tile grid.

```ts
Person (extends Entity) {
  // Inherited
  id:       Uint32
  type:     Uint8      // PERSON entity type
  chunkX:   Int16
  chunkY:   Int16
  localX:   Float32
  localY:   Float32

  // Person-specific (packed)
  needs:    Uint8[6]   // hunger, sleep, cleanliness, toilet, social, mood
  behavior: Uint8      // current state machine state
  target:   Uint32     // entity or tile id of current goal
  memorySlot: Uint16   // index into memory store (see below)
  traits:   Uint8      // packed personality bits
  schedule: Uint8      // assigned work shift / role
}
```

People are stored in a `PersonPool` — a fixed-size typed buffer (no per-person object allocation).

---

## Day Cycle

A single game day = configurable number of sim ticks. Default: 1440 ticks/day (1 tick = 1 game minute at 10 TPS → 2.4 min real-time per day).

### Day Phases

| Phase    | Tick range       | Effect on people                       |
|----------|------------------|----------------------------------------|
| Dawn     | 360–480 (06–08)  | Wake-up window, hunger climbs          |
| Day      | 480–1080 (08–18) | Work hours, social rises if isolated   |
| Dusk     | 1080–1260 (18–21)| Wind-down, dinner, leisure             |
| Night    | 1260–360 (21–06) | Sleep window, sleep need restored      |

Time-of-day modifies need decay/restore rates. People react to phase transitions, not to wall-clock time.

### Determinism

Day phase is pure function of `tick % 1440`. No `Date` calls. Sim worker computes phase from input tick number.

---

## Needs System

Six needs, each a `Uint8` (0–255). 0 = critical, 255 = fully satisfied.

| Need        | Decay/tick | Restore source                    | Critical effect          |
|-------------|------------|-----------------------------------|--------------------------|
| Hunger      | -1         | Eat at table / kitchen            | Mood penalty, collapse   |
| Sleep       | -0.5       | Sleep in bed (night phase)        | Slow work, mood penalty  |
| Cleanliness | -0.3       | Bathe (wash building / well)      | Mood penalty, social -   |
| Toilet      | -1         | Use toilet                        | Forced behavior override |
| Social      | -0.2       | Be near another person (radius 3) | Mood penalty, withdrawn  |
| Mood        | derived    | Function of all other needs       | Affects work output      |

### Mood Formula

```text
mood = clamp(
  baseMood
  + 0.2 * hunger
  + 0.2 * sleep
  + 0.15 * cleanliness
  + 0.1 * toilet
  + 0.15 * social
  + 0.2 * recentMemoryWeight,
  0, 255
)
```

`recentMemoryWeight` is the sum of mood deltas from short-term memory (see below).

### Critical Thresholds

When a need drops below `CRITICAL_THRESHOLD` (default 32):

- Behavior state machine forces a satisfaction action (override current task)
- Mood receives a per-tick penalty until restored above threshold
- Memory event logged

When a need reaches 0:

- Person becomes incapacitated (collapse animation, no work output)
- Requires intervention from another person or player

---

## Behavior State Machine

Each person runs a small state machine, evaluated each sim tick.

```text
IDLE → WORK → IDLE
     ↘ EAT  ↗
     ↘ SLEEP ↗
     ↘ BATHE ↗
     ↘ TOILET ↗
     ↘ SOCIAL ↗
     ↘ COLLAPSED (need = 0)
```

### State Selection (per tick)

1. If any need < `CRITICAL_THRESHOLD` → switch to satisfaction state for that need (priority: toilet > hunger > sleep > cleanliness > social)
2. Else if in scheduled work window → WORK
3. Else if mood < `IDLE_MOOD_THRESHOLD` → SOCIAL
4. Else → IDLE

States are pure functions of (needs, tick, schedule). Same input → same state.

### Implementation Note — Task Stack (Phase 7.5+)

The Phase 7.5 settler controller already has a generic LIFO task stack on top of the path-level state machine — see [22_pathfinding.md](22_pathfinding.md#task-stack-phase-75). When this people-system layer ships, "satisfaction" states above are not parallel branches in the controller; they're **injected sub-tasks** pushed on top of the active job task:

```ts
// hunger crosses CRITICAL_THRESHOLD → push, don't replace
controller.pushTask({ kind: "eat", target: nearestKitchen });
```

Completion pops the task and the suspended job resumes. This keeps the people-system implementation small (one push per critical need) and preserves the single-active-task invariant the rest of the controller relies on.

---

## Memory System

Memory is what makes people feel persistent across days. Two tiers.

### Short-Term Memory

Per-person ring buffer of recent events.

```ts
ShortTermMemory {
  capacity: 16            // events
  events: MemoryEvent[16]
  head: Uint8             // ring index
}

MemoryEvent {
  type:      Uint8        // event type enum
  tick:      Uint32       // when it happened
  subjectId: Uint32       // who/what was involved
  moodDelta: Int8         // immediate mood impact (-128..127)
  weight:    Uint8        // current weight (decays)
}
```

- Events overwrite oldest when full
- Each event's `weight` decays by 1 per day until 0 → eligible for promotion or eviction
- Events feed into `recentMemoryWeight` for mood calculation

### Long-Term Memory

Sparse store of significant events that survived short-term decay or crossed a significance threshold.

```ts
LongTermMemory {
  events: LongTermEvent[]    // pooled, max ~32 per person
}

LongTermEvent {
  type:      Uint8
  firstTick: Uint32          // when it first occurred
  lastTick:  Uint32          // most recent reinforcement
  subjectId: Uint32
  weight:    Uint16          // accumulated significance
  flags:     Uint8           // positive/negative/trauma/bond
}
```

### Promotion Rules

A short-term event is promoted to long-term when:

- Its absolute `moodDelta` exceeds `SIGNIFICANCE_THRESHOLD` (e.g. ±50), OR
- It repeats the same `(type, subjectId)` ≥ 3 times within N days (forms a pattern)

### Decay Rules

| Memory tier | Decay                                 |
|-------------|---------------------------------------|
| Short-term  | weight -1 per day, evicted at 0       |
| Long-term   | weight -1 per 30 days, never below 1  |

Long-term memories never fully disappear — they fade to background influence.

### Memory Event Types — current

Phase 7 logs settler-action events; the mood-driven entries below are still future. Stable enum codes — saves reference these by number, so existing values are not renumbered.

| Code | Type           | Phase shipped | Trigger                                                    |
|------|----------------|---------------|------------------------------------------------------------|
| 0    | EMPTY          | 7             | Ring-buffer sentinel (slot never filled)                   |
| 1    | HARVESTED      | 7             | Settler harvested a crop tile                              |
| 2    | PLANTED        | 7             | Settler planted a seed on a tilled tile                    |
| 3    | WATERED        | 7             | Settler watered a crop                                     |
| 4    | HAULED_WATER   | 7             | Settler refilled water reserve at a water source           |
| 5    | HAULED_SEED    | 7             | Settler withdrew a seed from a container                   |
| 6    | DEPOSITED      | 7             | Settler dropped carried items at a crate                   |

Source of truth: `MEMORY_EVENT_TYPES` in `src/state/entities/living_entity.ts`. The Person window resolves codes to human-readable strings ("Stored Wheat at (8, 8)").

### Memory Event Types — target / future

The mood-affecting events below are planned for the full people system. Mood deltas are illustrative. New codes will append to the enum (start at 7+, never reuse).

| Type            | Trigger                                          | Mood delta |
|-----------------|--------------------------------------------------|------------|
| MEAL_GOOD       | Ate well-prepared food                           | +20        |
| MEAL_BAD        | Forced to eat raw / spoiled                      | -30        |
| BAD_SLEEP       | Slept poorly (interrupted, dirty bed)            | -25        |
| GIFT_RECEIVED   | Player or person gave a gift                     | +40        |
| INSULT          | Rude interaction with another person             | -50        |
| WORK_PROMOTION  | Assigned a higher-tier role                      | +60        |
| WORK_FIRED      | Removed from role                                | -70        |
| FRIEND_MADE     | Repeated positive interactions w/ same person    | +30        |
| BIRTHDAY        | Recognized birthday                              | +20        |
| INJURY          | Crop accident, animal kick                       | -40        |

Each event is also a hook for narrative (NPC dialog, journal entries).

---

## Roles & Schedules

Each person has an assigned role that determines their work behavior.

| Role          | Work tile types                | Output                                        |
|---------------|--------------------------------|-----------------------------------------------|
| Farmhand      | Crops, irrigation              | Auto-water, harvest                           |
| Animal keeper | Animal pens                    | Feed animals, collect produce                 |
| Production    | Buildings (mill, bakery, etc.) | Stock inputs, run cycles                      |
| Cook          | Kitchen                        | Prepare meals (raises Hunger restore quality) |
| Caretaker     | Other people                   | Help collapsed/sick people                    |
| Idle          | None                           | Roams, socializes                             |

Schedule is a `Uint8` bitmask of work hours within the day (e.g. 8 hours marked active). Default: 08:00–17:00 (day phase).

---

## Spatial Behavior

People navigate the farm using a coarse pathfinder over the chunk tile grid.

- **Pathfinding scope**: chunk-local primarily; cross-chunk routes computed at chunk seams
- **Avoidance**: people don't collide; they queue (wait state) at occupied workstations
- **Home tile**: each person has an assigned bed/home tile they return to

Movement is sub-tile (`localX`, `localY` floats). Sim updates discrete tile occupation; render interpolates.

---

## Player Interaction

Players can:

- **Hire** new people (limit per phase / level)
- **Assign roles & schedules**
- **Give gifts** (raises mood, adds memory event)
- **Talk** (raises social, surfaces memory-driven dialog)
- **Fire / reassign**

People remember player actions in long-term memory, influencing future interactions (greetings, willingness to work, gift acceptance).

---

## Performance Considerations

People are entities, not tiles — but they tick every sim cycle.

| Metric                    | Budget                |
|---------------------------|-----------------------|
| Max people per save       | 64 (MVP target)       |
| Tick cost per person      | <0.1ms                |
| Memory per person         | ~256 bytes            |
| Long-term store per person| ~1 KB                 |

People sim runs in the same simulation worker as crop/building ticks. Pathfinding lives in a dedicated worker — see [22_pathfinding.md](22_pathfinding.md) for the engine and the autonomous-job system this builds on.

---

## Determinism Rules

- Need decay rates: constants
- State transitions: pure function of (needs, tick, schedule, memory)
- Memory event triggers: deterministic from sim state
- "Random" trait variation: seeded RNG (worldSeed + personId)

A given sim trace replays identically with the same seed.

---

## Save Format Addition

```ts
SavedPerson {
  id:         Uint32
  type:       Uint8
  chunkX:     Int16
  chunkY:     Int16
  localX:     Float32
  localY:     Float32
  needs:      Uint8[6]
  behavior:   Uint8
  target:     Uint32
  traits:     Uint8
  schedule:   Uint8
  shortTerm:  MemoryEvent[16]
  longTerm:   LongTermEvent[≤32]
}
```

People are persisted globally, not per chunk (they roam across chunks).

---

## Phase Plan

People system is **not in MVP**. Actual landing landed differently from the original Phase 3–5 sketch — autonomous behavior arrived in Phase 7 ahead of needs/mood:

- **Phase 3**: NPCs are static order-givers (no needs, no memory) — ✅ shipped
- **Phase 6**: Possession layer — player can pilot any settler — ✅ shipped
- **Phase 7**: Autonomous job-driven settlers, named identities, action memory ring buffer — ✅ shipped (no needs decay yet)
- **Phase 7.5**: Task-stack architecture that needs/mood will hook into — ✅ shipped (foundation only)
- **Future (TBD)**: Needs decay + day cycle + critical-threshold task injection
- **Future**: Memory promotion (short → long), full mood formula, role assignments
- **Future**: Relationships, dialog, narrative hooks

See [19_roadmap.md](19_roadmap.md) for phase-level deliverables.
