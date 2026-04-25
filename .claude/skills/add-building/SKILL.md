---
name: add-building
description: Use when adding a new production building (mill, bakery, smelter, etc.) to the game. Walks through ID allocation, recipe definition, tier placement, and unlock.
---

# Add a Building

A production building is a tileId in range 200–299 with one tile slot. It defines an input → output recipe consumed by the queue-based simulation.

## Steps

### 1. Pick a tileId

Open [data/buildings.json](../../../data/buildings.json). Pick the next free id in the appropriate tier range:

- Tier 1 (starter): 200–209
- Tier 2 (mid game): 210–219
- Tier 3 (advanced): 220–229
- Irrigation: 230–239

### 2. Define the recipe

Inputs and outputs reference item ids from [data/prices.json](../../../data/prices.json).

```json
{
  "id": <tileId>,
  "name": "<lowercase_name>",
  "displayName": "<Display Name>",
  "tier": <1|2|3>,
  "inputItems": [
    { "itemId": <id>, "quantity": <n> }
  ],
  "outputItems": [
    { "itemId": <id>, "quantity": <n> }
  ],
  "cycleTime": <seconds>,
  "queueSize": <2|4|6>,
  "upgradeLevels": 4,
  "unlockLevel": <level>
}
```

Tier defaults:
- Tier 1: cycleTime 20–60s, queueSize 2
- Tier 2: cycleTime 40–90s, queueSize 4
- Tier 3: cycleTime 90–180s, queueSize 6

### 3. Define output item (if new)

If the output item doesn't exist yet, add it to [data/prices.json](../../../data/prices.json):

```json
{ "id": <id>, "name": "<name>", "category": "<processed|final_good|material>", "basePrice": <coins> }
```

Pricing rule of thumb: output basePrice ≥ sum of input basePrices × 1.5.

### 4. Add unlock

Append to [data/unlocks.json](../../../data/unlocks.json):

```json
{ "level": <level>, "type": "building", "targetId": <tileId>, "name": "<name>" }
```

### 5. Reserve atlas slot

Add the building tile to [data/tiles.json](../../../data/tiles.json) and reserve an atlas slot.

For animated buildings (smoke, gears), reserve adjacent atlas slots for animation frames.

### 6. Add sprite

Add the building sprite to the atlas. Buildings occupy 1 tile in MVP.

### 7. Validate the chain

Confirm the supply chain is reachable:
- Inputs are crops, animal products, or outputs of earlier-tier buildings
- Output is consumed by NPC orders, a later-tier building, or sold direct

## Output

State the new building's tileId, recipe summary, tier, and unlock level. Do not modify simulation code — the queue simulation reads from JSON and handles any valid `BuildingDef`.
