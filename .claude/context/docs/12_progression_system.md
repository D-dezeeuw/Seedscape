# Seedscape — Progression System

## Principle

Progression unlocks capability, not content gating. Players can always farm; unlocks expand what and how efficiently.

---

## XP System

Player earns XP for all meaningful actions:

| Action                  | XP reward |
|-------------------------|-----------|
| Harvest crop            | +1–5      |
| Fulfill NPC order       | +10–30    |
| Complete production run | +5–15     |
| Unlock new building     | +20       |
| Expand to new chunk     | +25       |
| Discover new biome      | +50       |

XP is additive and stored as a running total. No decay.

---

## Level Curve

```
xpRequired(level) = BASE_XP * (level ^ EXPONENT)
```

Defaults:
- `BASE_XP` = 100
- `EXPONENT` = 1.6

| Level | XP required | Total XP |
|-------|-------------|----------|
| 1     | 100         | 100      |
| 2     | 303         | 403      |
| 5     | 1,149       | 3,574    |
| 10    | 3,981       | 18,170   |
| 20    | 13,804      | 85,231   |
| 50    | 105,737     | —        |

No hard level cap (infinite progression).

---

## Unlock System

Unlocks are gated by player level and optional prerequisite unlocks.

```
UnlockDef {
  id:           Uint16
  requiredLevel: Uint8
  requiredUnlocks: Uint16[]   // prerequisite unlock ids
  type:         enum (Building, Crop, Tool, BiomeAccess, Feature)
  targetId:     Uint16        // what is unlocked
  cost:         Uint32        // coins to activate (optional)
}
```

### Unlock Tree Example

```
Level 1  → Wheat, Carrot, Basic Well
Level 3  → Mill, Corn
Level 5  → Smelter, Bakery
Level 7  → Sprinkler, Juicer
Level 10 → Stoneveil Highlands access
Level 15 → Forge, Dairy
Level 20 → Sunfen Delta access
Level 30 → Refinery, Press
Level 40 → Voidsoil Expanse access
Level 50 → Lab, endgame chains
```

---

## Soft Gating Mechanics

Players are never hard-blocked; progression is made desirable, not mandatory.

| Mechanic            | Effect                                      |
|---------------------|---------------------------------------------|
| Tool tier limits    | Low-tier tools slower, not disabled         |
| Biome access        | Player can enter any biome; unlock boosts efficiency |
| Building upgrades   | Unlocked buildings work at tier 0 always    |
| NPC order scaling   | Higher-value orders appear at higher levels |
| Resource scarcity   | Endgame materials naturally rare, not locked|

---

## Difficulty Scaling

As player level increases, the world responds:

| Level range | Effect                                           |
|-------------|--------------------------------------------------|
| 1–10        | Bloomridge safe zone; gentle economy             |
| 10–20       | NPC orders become more complex (multi-item)      |
| 20–35       | Inflation pressure increases; costs scale up     |
| 35–50       | Biome hazards become meaningful (Highlands frost)|
| 50+         | Voidsoil challenges; advanced chain required     |

Scaling is simulation-driven (NPC demand tables, decay rates), not scripted events.

---

## Achievement Layer

Achievements reward milestones without blocking progression.

| Achievement            | Trigger                               |
|------------------------|---------------------------------------|
| First Harvest          | Harvest any crop                      |
| Market Mogul           | Sell 1,000 coins worth in one session |
| Chain Builder          | Run 3 production buildings at once    |
| Biome Explorer         | Enter all 4 biomes                    |
| Infinite Farmer        | Reach level 50                        |

Achievements are cosmetic / stat rewards only.

---

## Player State

```
PlayerState {
  level:       Uint8
  xp:          Uint32
  coins:       Uint32
  unlockedIds: Uint16[]    // sorted list of unlocked ids
  achievements: Uint64     // bitfield
}
```

Stored in save file; does not live in chunk data.
