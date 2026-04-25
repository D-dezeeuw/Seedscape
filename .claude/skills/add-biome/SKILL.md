---
name: add-biome
description: Use when adding a new biome to the game world. Walks through biome definition, tile table, resource list, gameplay modifiers, and assignment rule.
---

# Add a Biome

A biome defines visual style, tile palette, resource distribution, and gameplay modifiers for a region of the procedural world.

## Steps

### 1. Pick a biome id

Lowercase, single word. Existing: `bloomridge`, `stoneveil`, `sunfen`, `voidsoil`.

### 2. Define modifiers

Open [data/biomes.json](../../../data/biomes.json). Append to the `biomes` array:

```json
{
  "id": "<name>",
  "displayName": "<Display Name>",
  "isStarter": false,
  "climate": "<temperate|cold|humid|arid>-<moist|dry|warm|hostile>",
  "difficulty": "<beginner|intermediate|advanced>",
  "modifiers": {
    "growthRate": 1.0,
    "fertility": "<low|medium|high|very-high>",
    "weatherHazards": [],
    "waterAccess": "<none|hard|easy|abundant>"
  },
  "tileTable": { },
  "resources": [ ]
}
```

Reference values:
- Bloomridge: 1.0× growth (baseline)
- Stoneveil: 0.7× growth (penalty)
- Sunfen: 1.3× growth (bonus)
- Voidsoil: 0.4× growth (harsh)

### 3. Define the tile table

Map terrain × moisture noise bands to ground tile ids (from [data/tiles.json](../../../data/tiles.json) `ground` array).

```json
"tileTable": {
  "0": "<water_tile_name>",
  "1-2:high": "<wet_soil_name>",
  "1-2:low": "<dry_soil_name>",
  "3-5": "<main_terrain_name>",
  "6-7": "<peak_terrain_name>"
}
```

If new ground tile types are needed, add them to `tiles.json` `ground` array first (using ids in the 0–99 range).

### 4. Define resources

List crops, ores, and unique materials. Rarity values: `abundant`, `common`, `uncommon`, `rare`.

```json
"resources": [
  { "name": "<resource_name>", "rarity": "<rarity>" }
]
```

If a resource maps to a crop, ensure that crop's `biomes` array includes this biome.

### 5. Add biome assignment rule

Append to `biomeAssignment` in `biomes.json`:

```json
{ "when": { "biomeNoise": "<low|high|very-low>", "moisture": "<low|high|very-low>" }, "biome": "<id>" }
```

Order matters — first match wins. Ensure your rule doesn't shadow an earlier biome.

### 6. Add unlock entry

If the biome is gated, append to [data/unlocks.json](../../../data/unlocks.json):

```json
{ "level": <level>, "type": "biome", "targetId": "<id>" }
```

### 7. Add atlas tiles

Reserve atlas slots for any new ground tiles, decorations, or biome-specific resources.

### 8. Validate generation

Generation is data-driven — if `biomes.json` is well-formed, the worker pipeline ([07_world_generation.md](../../context/docs/07_world_generation.md)) generates the new biome automatically.

## Common Pitfalls

- Tile names in `tileTable` must match `name` fields in `tiles.json` `ground`. Typos silently fall back.
- Resource crops must have the biome in their `biomes` allowlist in `crops.json`.
- Assignment rules with overlapping conditions: earlier rule wins.
- Adding a biome with an `isStarter: true` collides with Bloomridge — never set this on a non-starter.
