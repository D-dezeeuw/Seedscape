---
name: shader-work
description: Use when writing or modifying GLSL shaders, vertex/fragment code, atlas UV mapping, instance buffer layout, or any WebGL2 rendering pipeline code.
---

# Shader Work

One vertex shader + one fragment shader handle every tile. No per-tile branching on tileId.

## Mandatory Reading

1. [rendering pipeline](../../context/docs/04_rendering_pipeline.md) — pipeline overview
2. [rendering shaders](../../context/docs/15_rendering_shaders.md) — full GLSL contract
3. [data model — GPU instance buffer](../../context/docs/05_data_model.md) — instance attribute layout

## Hard Rules

- **One shader pair only.** Branching on tile type goes through atlas UV, not GLSL `if`.
- **No texture sampling in vertex shader.** All texture reads in fragment.
- **Atlas is bound once per frame.** Shared across all chunk draws.
- **State flags are 8 bits packed into a float attribute.** Decode in fragment via `int(v_stateFlags)` and bit-shifts.
- **Tile size and atlas dimensions are uniforms**, not constants. Set per render config, not per draw.
- **`u_time` wraps at 3600s** to avoid float precision drift.

## Instance Buffer Layout (per tile)

```
worldX:     Float32   // 4 bytes
worldY:     Float32   // 4 bytes
tileIndex:  Float32   // 4 bytes  (atlas lookup)
stateFlags: Float32   // 4 bytes  (packed bits)
```

Stride: 16 bytes. 1024 tiles per chunk → 16 KB.

## Atlas UV Math

```glsl
float col = mod(tileIndex, atlasSize.x);
float row = floor(tileIndex / atlasSize.x);
vec2 uv = vec2(
  (col + quadPos.x + 0.5) / atlasSize.x,
  (row + quadPos.y + 0.5) / atlasSize.y
);
```

Half-pixel offset prevents bleeding between adjacent atlas tiles.

## State Flag Decoding

State flag values are defined in [data/tiles.json](../../../data/tiles.json) under `stateFlags`. Mirror these as GLSL bit positions:

```glsl
int flags = int(v_stateFlags);
int wilted   = (flags >> 0) & 1;
int watered  = (flags >> 1) & 1;
int selected = (flags >> 2) & 1;
int animated = (flags >> 3) & 1;
```

## Performance Targets

- <200 draw calls/frame
- 50K–200K visible tiles
- Chunk GPU upload <10ms

## Common Pitfalls

- Don't use `texture2D` in vertex shader (precision + perf).
- Don't reallocate instance buffer every frame — only on dirty.
- Don't recompute view-projection matrix in shader; pass as uniform.
- Don't sample atlas with linear filtering on tile edges (bleeding).
