# Seedscape — Economy System

## Principle

The economy is a simulation, not a fixed reward schedule. Prices respond to supply and demand. Players can exploit or stabilize markets.

---

## Currency

Single currency: **Coins**.

- No premium currency in core design
- Coins earned via selling goods to NPCs or market
- Coins spent on seeds, buildings, unlocks, upgrades

---

## Coin Flow

```
Harvest → Inventory → Sell (NPC order / Market) → Coins
Coins → Seeds / Buildings / Upgrades
```

---

## NPC Order System

NPCs generate buy orders for goods.

```
NPCOrder {
  itemId:    Uint16    // requested item
  quantity:  Uint16    // units requested
  priceEach: Uint32    // coins per unit (derived)
  expiresIn: Uint16    // ticks until order expires
}
```

### Order Generation Rules

- Each NPC generates 1–3 active orders at a time
- Orders refresh on fulfillment or expiry
- Item selection weighted by biome proximity and NPC type
- Price set at order creation using current demand model

---

## Pricing Model

Price is a function of global supply (recent sales volume) and fixed base price.

```
price = basePrice * demandMultiplier

demandMultiplier = clamp(
  1.0 + (demandPressure - supplyPressure) * sensitivity,
  MIN_MULTIPLIER,   // 0.4
  MAX_MULTIPLIER    // 3.0
)
```

### Demand Pressure

- Rises when NPC orders go unfilled
- Decays naturally each tick cycle

### Supply Pressure

- Rises when player sells large quantities
- Decays naturally each tick cycle

---

## Supply/Demand Decay

Both pressures decay toward 0 each economic tick (every N simulation ticks).

```
demandPressure *= DEMAND_DECAY   // e.g. 0.95 per eco-tick
supplyPressure *= SUPPLY_DECAY   // e.g. 0.90 per eco-tick
```

Decay rates tunable per economy tier.

---

## Market (Player-to-Player or Global Pool)

A global market allows selling goods at current market price without a specific NPC order.

- Price = current market price (supply/demand driven)
- Instant sale up to `marketDepth` units
- Excess units queued; fulfilled as demand rises

Market acts as a price floor stabilizer for early game.

---

## Inflation Control

To prevent runaway economy:

| Mechanism             | Rule                                        |
|-----------------------|---------------------------------------------|
| Price floor           | No item sells below 40% of base price       |
| Price ceiling         | No item sells above 300% of base price      |
| Sink spending         | Building upgrades, expansions drain coins   |
| Recurring costs       | Tool durability / building maintenance      |
| Supply cap per tick   | Max sellable units per eco-tick enforced    |

---

## Item Base Prices

| Item          | Base price (coins) | Category     |
|---------------|--------------------|--------------|
| Wheat         | 2                  | Raw crop     |
| Carrot        | 5                  | Raw crop     |
| Corn          | 4                  | Raw crop     |
| Flour (wheat) | 12                 | Processed    |
| Bread         | 25                 | Final good   |
| Carrot juice  | 18                 | Final good   |
| Corn oil      | 30                 | Final good   |
| Iron ingot    | 40                 | Material     |
| Stone block   | 8                  | Material     |

---

## Economy Tick Cadence

Economy simulation runs at a lower frequency than crop simulation.

| Loop            | Cadence     |
|-----------------|-------------|
| Crop simulation | 5–20 TPS    |
| Economy tick    | Every 30s   |
| NPC order refresh| Every 60s  |
| Market price update| Every 30s|
