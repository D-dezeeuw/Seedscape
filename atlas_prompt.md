# Atlas-generation prompt for ChatGPT (image generation)

Copy everything between the `---` markers and paste into ChatGPT (with image-generation enabled). Attach the current `public/atlas.png` if you want the model to keep colors/style consistent with the placeholder.

---

I need a single PNG texture atlas for a top-down 2D farming simulation game. Replace the attached placeholder atlas with a properly-textured version.

## Hard format requirements

- Output: **one PNG, 2048 × 2048 pixels**, with transparency support (RGBA).
- Layout: a strict **64 × 64 grid of 32×32-pixel tiles** (4096 tiles total). Tile index N goes at column `N % 64`, row `floor(N / 64)`. Top-left corner of the image is index 0.
- Tiles must be **pixel-perfect at 32×32**. No anti-aliased blur across tile boundaries — each tile is its own self-contained sprite.
- Same-type tiles (water, soil, grass, sand) must **tile seamlessly** when placed edge-to-edge. Test by mentally tiling a 2×2 patch of each: no visible seam.
- Top-down ("god view") perspective. No 3D shading or perspective distortion. Style is **soft pixel art**, cozy farming-sim aesthetic (think Stardew Valley / Animal Crossing). Warm, inviting palette.
- Empty grid cells (any index not listed below) should be **fully transparent** (alpha = 0).

## Tiles to render — exact index → content

### Ground (row 0, columns 0–25)

| Index | Tile | Description |
|---|---|---|
| 0 | shallow_water | Clear teal-blue water, faint ripple pattern, lighter than deep |
| 1 | deep_water | Deep navy-teal, gentle wave hints, darker than shallow |
| 10 | dry_grass | Pale yellow-green, scattered short grass tufts, sun-bleached |
| 11 | rich_soil | Warm dark brown, slightly moist look, fertile and crumbly |
| 12 | farmland_untilled | Lighter brown, dry crumbly soil ready to be worked |
| 13 | farmland_tilled | Brown with parallel furrow grooves (darker shadow lines) |
| 20 | rocky_outcrop | Mid-gray weathered stone with cracks, some moss tinge |
| 22 | barren_stone | Pale dusty gray, dry stony ground, sparse pebbles |
| 25 | beach_sand | Pale tan/cream, soft grainy texture, slight wind ripples |

### Crops — 8 growth stages each, indices increase as the crop grows

| Indices | Crop | Stage notes |
|---|---|---|
| 100–107 | wheat | 100 = bare seeded soil with single sprout; 107 = full golden-yellow wheat ready to harvest. Intermediate stages show progressively taller green stalks turning gold. |
| 108–115 | carrot | 108 = sprout tips poking out; 115 = lush green leafy top with hint of orange root visible. |
| 116–123 | corn | 116 = small green sprout; 123 = tall stalk with one yellow-green cob, leaves spreading. |

Each crop tile shows the plant **on its own soil** — soil background should match `farmland_tilled` (index 13) so a crop tile dropped onto tilled farmland looks continuous.

### Buildings (single 32×32 tile, top-down)

| Index | Building | Description |
|---|---|---|
| 200 | mill | Small wooden windmill, gray stone base, dark wooden blades visible from above, slight shadow |
| 210 | bakery | Stone-walled cottage with red-tile roof, small chimney with hint of smoke, oven warmth glowing through one window |

## Style guide

- **Palette:** warm, cozy. Greens lean yellow-green not blue-green. Browns are warm not cool. Water leans teal not sky-blue.
- **Edges:** clean pixel edges, no soft glows except the mill/bakery roof shadow.
- **Detail level:** readable at 32×32 zoomed out, with one or two small detail elements per tile (e.g. a pebble, a tuft, a ripple) — no busy noise.
- **Consistency:** same lighting direction across all tiles (top-left light source). All tiles drawn at the same zoom level / camera height.

## Output

Return one 2048 × 2048 PNG titled `atlas.png`. All non-listed cells must be fully transparent. Do not add labels, gridlines, or watermarks — just the tile graphics.

---

## Notes for the human (not part of the prompt)

- Most consumer image models can't natively output 2048×2048 with strict 32-pixel grid alignment. If the result is blurry or misaligned, you have two practical fallbacks:
  1. **Generate per-tile.** Ask ChatGPT to produce one 256×256 or 512×512 image per tile, then downscale each to 32×32 with nearest-neighbor and composite into the grid yourself (a small script using sharp or Pillow).
  2. **Generate at lower resolution and upscale.** Ask for a 1024×1024 atlas with 16×16 tiles per cell, then upscale 2× with nearest-neighbor — keeps pixel-art crispness.
- The placeholder atlas at `public/atlas.png` is already 2048×2048 with the right grid spacing, so swapping in the new file just works — no code changes needed.
- After regenerating, test in-game by hard-refreshing (Cmd-Shift-R / Ctrl-Shift-R). Tile IDs not covered by the prompt (e.g. 21, 23, 30+) will show transparent until you regenerate them — fine for now since worldgen doesn't produce them yet.
- If you get stuck on any single tile, you can re-prompt for just that index with the same format guide and paste the new tile into the existing atlas via your image editor.
