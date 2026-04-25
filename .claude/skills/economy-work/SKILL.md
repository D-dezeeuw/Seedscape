---
name: economy-work
description: Use when implementing or modifying economy systems — pricing formulas, NPC orders, supply/demand, inflation controls, market mechanics, or coin flow.
---

# Economy Work

The economy is a simulation, not a fixed reward schedule. Prices respond to supply/demand pressure.

## Mandatory Reading

1. [economy system](../../context/docs/10_economy_system.md) — pricing formula, NPC orders
2. [progression](../../context/docs/12_progression_system.md) — XP rewards on sale

## Hard Rules

- **Prices are in `data/prices.json`** with constraints. Do not hardcode `basePrice` in code.
- **One currency: coins.** No premium currency in core design.
- **Single price formula:** `price = basePrice * demandMultiplier`, with multiplier clamped between `MIN_MULTIPLIER` and `MAX_MULTIPLIER` (from `data/prices.json`).
- **Demand and supply pressures decay each economy tick** — never accumulate unbounded.
- **Economy ticks at 30s cadence**, separate from the 5–20 TPS sim loop.
- **MVP uses fixed prices** (no demand multiplier active). Dynamic pricing lands in Phase 4.

## Pricing Math

```ts
demandMultiplier = clamp(
  1.0 + (demandPressure - supplyPressure) * sensitivity,
  constraints.minMultiplier,
  constraints.maxMultiplier
);
price = item.basePrice * demandMultiplier;
```

Each economy tick:
```ts
demandPressure *= constraints.demandDecay;   // 0.95
supplyPressure *= constraints.supplyDecay;   // 0.90
```

## NPC Order Schema

```ts
type NPCOrder = {
  itemId: number;       // Uint16
  quantity: number;     // Uint16
  priceEach: number;    // Uint32, snapshot at order creation
  expiresIn: number;    // Uint16, ticks until expiry
};
```

Each NPC: 1–3 active orders. Orders refresh on fulfillment or expiry.

## Inflation Sinks (required to keep economy stable)

- Building purchases
- Building upgrades
- Expansion unlocks
- Tool durability / maintenance

When adding a new earnings source, also identify the sink that absorbs it.

## Common Pitfalls

- Forgetting decay → demand/supply diverge unbounded.
- Hardcoding prices in code (must come from JSON).
- Using sim TPS for economy tick (should be 30s wall-clock-equivalent).
- Letting players sell unlimited per economy tick (use supply cap from constraints).
