---
name: add-crop
description: Use when adding a new crop type to the game (e.g. "add tomato", "add a new crop"). Walks through the JSON edit, ID allocation, atlas slot, and unlock placement.
---

# Add a Crop

A crop is a tileId in range 100–199 with 8 sequential ids reserved (one per growth stage).

## Steps

### 1. Pick a tileId range

Open [data/crops.json](../../../data/crops.json). Find the next free 8-id block in the 100–199 range.

Existing allocations:
- 100–107 wheat
- 108–115 carrot
- 116–123 corn
- 124–131 sunflower
- 132–139 rice

Next free: 140–147, 148–155, etc.

### 2. Add the crop entry

Append to `crops` array in `data/crops.json`:

```json
{
  "id": <baseId>,
  "name": "<lowercase_name>",
  "displayName": "<Display Name>",
  "baseRate": 1.0,
  "stageThreshold": 1.0,
  "stages": 8,
  "wiltThreshold": 240,
  "harvestYield": 4,
  "harvestVariance": 1,
  "biomes": ["bloomridge"],
  "unlockLevel": <level>
}
```

Pick `baseRate` relative to existing crops:
- 0.5 = slow (corn-tier)
- 0.7–0.8 = medium
- 1.0 = fast (wheat baseline)
- 1.3+ = very fast

### 3. Add to prices

Append to `items` array in [data/prices.json](../../../data/prices.json):

```json
{ "id": <baseId>, "name": "<name>", "category": "raw_crop", "basePrice": <coins> }
```

Reference base prices: wheat=2, carrot=5, corn=4, sunflower=6, rice=8.

### 4. Add unlock entry

Append to `unlocks` array in [data/unlocks.json](../../../data/unlocks.json):

```json
{ "level": <level>, "type": "crop", "targetId": <baseId>, "name": "<name>" }
```

### 5. Reserve atlas slots

Open [data/tiles.json](../../../data/tiles.json) and add atlas slot reservations for the 8 growth stages. Atlas layout convention: each crop gets one row of 8 stages.

### 6. Add sprites

Add 8 stage sprites to the atlas texture file. Tile 0 = seeded (just planted), tile 7 = ready to harvest.

### 7. (When code exists) Validate at startup

Code that loads `crops.json` should assert:
- No id collisions across crops
- All `biomes` references exist in `biomes.json`
- `unlockLevel` matches an entry in `unlocks.json`

## Output

Confirm the new crop's id, biome, and unlock level. List the files touched. Do not modify simulation code — the existing growth simulation reads from JSON and works for any crop with a valid `CropDef`.
