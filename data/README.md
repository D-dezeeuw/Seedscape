# Seedscape — Game Content Data

JSON files in this directory are the **source of truth** for game content. Code imports them; design docs reference them.

## Files

| File             | Schema doc                                        |
|------------------|---------------------------------------------------|
| `crops.json`     | [09_farming_system.md](../.claude/context/docs/09_farming_system.md) |
| `buildings.json` | [11_production_system.md](../.claude/context/docs/11_production_system.md) |
| `biomes.json`    | [08_biomes.md](../.claude/context/docs/08_biomes.md) |
| `unlocks.json`   | [12_progression_system.md](../.claude/context/docs/12_progression_system.md) |
| `prices.json`    | [10_economy_system.md](../.claude/context/docs/10_economy_system.md) |
| `tiles.json`     | [05_data_model.md](../.claude/context/docs/05_data_model.md) |

## Editing Rules

- **Content change** (new crop, price tweak, building tier) → edit JSON.
- **Rule change** (new growth modifier, new pricing formula) → edit doc, then update JSON shape if needed.
- **Always validate**: code should load + assert these on startup.

## ID Allocation

To avoid collisions, IDs are allocated by range. See `tiles.json` `_ranges` field.

| Range     | Category            |
|-----------|---------------------|
| 0–99      | Ground / terrain    |
| 100–199   | Crop tiles          |
| 200–299   | Production buildings|
| 300–399   | Decorations         |
| 400–499   | Animals             |
| 500+      | Reserved            |
