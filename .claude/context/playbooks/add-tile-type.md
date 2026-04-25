# Playbook — Add a Tile Type

A "tile type" is any new entry in the tileId space (ground, decoration, animal, etc.) that isn't a crop or building. For crops use [add-crop skill](../../skills/add-crop/SKILL.md). For buildings use [add-building skill](../../skills/add-building/SKILL.md).

## Steps

1. **Pick an id** in the appropriate range from [data/tiles.json](../../../data/tiles.json) `_ranges`:
   - Ground: 0–99
   - Decorations: 300–399
   - Animals: 400–499

2. **Add the entry** to the appropriate array in `tiles.json`. For ground:
   ```json
   { "id": <id>, "name": "<lowercase_name>" }
   ```

3. **Reserve an atlas slot.** Update `atlas.totalTiles` if needed.

4. **Add the sprite** to the atlas texture file.

5. **If interactive**, define behavior in:
   - Player input handler (which tile types respond to click)
   - Sim worker (if it has tick behavior — animals, growing decorations)

6. **If used in biomes**, update [data/biomes.json](../../../data/biomes.json) `tileTable` for the relevant biomes.

## Validation

- Tile id is unique across `tiles.json`
- Atlas slot count doesn't exceed `atlas.totalTiles`
- Code that iterates tile types reads from JSON, not a hardcoded enum
