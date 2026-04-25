# Seedscape — Rendering Shaders

## Principle

One vertex shader + one fragment shader handle all tile rendering via instanced draws. No per-tile shader variants.

---

## Shader Overview

| Shader   | Inputs                         | Output              |
|----------|--------------------------------|---------------------|
| Vertex   | Instance position, tile index  | Clip position, UVs  |
| Fragment | UVs, state flags               | Final pixel color   |

---

## Vertex Shader

### Inputs

```glsl
// Per-vertex (shared quad geometry)
attribute vec2 a_quadPos;       // [-0.5, 0.5] unit quad

// Per-instance (from instance buffer)
attribute vec2  a_tileWorld;    // tile world position (x, y)
attribute float a_tileIndex;    // atlas tile index
attribute float a_stateFlags;   // packed render state
```

### Uniforms

```glsl
uniform mat4  u_viewProjection;   // camera transform
uniform vec2  u_atlasSize;        // atlas dimensions in tiles (e.g. 16x16)
uniform float u_tileSize;         // world units per tile (e.g. 1.0)
```

### Responsibilities

1. Compute world position from tile grid position + quad offset
2. Compute atlas UV for tile index
3. Pass UV and state flags to fragment shader

### Implementation

```glsl
void main() {
  vec2 worldPos = a_tileWorld + a_quadPos * u_tileSize;
  gl_Position = u_viewProjection * vec4(worldPos, 0.0, 1.0);

  // Atlas UV
  float col = mod(a_tileIndex, u_atlasSize.x);
  float row = floor(a_tileIndex / u_atlasSize.x);

  v_uv = vec2(
    (col + a_quadPos.x + 0.5) / u_atlasSize.x,
    (row + a_quadPos.y + 0.5) / u_atlasSize.y
  );

  v_stateFlags = a_stateFlags;
}
```

---

## Fragment Shader

### Inputs

```glsl
varying vec2  v_uv;
varying float v_stateFlags;
```

### Uniforms

```glsl
uniform sampler2D u_atlas;
uniform float     u_time;       // for animation
```

### Responsibilities

1. Sample tile texture from atlas at UV
2. Decode state flags and apply visual effects
3. Output final color (with alpha for transparency)

### State Flag Encoding

`v_stateFlags` is a packed float decoded in the fragment shader.

```glsl
int flags = int(v_stateFlags);
int wilted    = (flags >> 0) & 1;  // wilt overlay
int watered   = (flags >> 1) & 1;  // moisture shimmer
int selected  = (flags >> 2) & 1;  // hover highlight
int animated  = (flags >> 3) & 1;  // animation enabled
```

### Implementation

```glsl
void main() {
  vec4 color = texture2D(u_atlas, v_uv);

  // Wilt desaturation
  if (wilted == 1) {
    float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    color.rgb = mix(color.rgb, vec3(gray), 0.7);
  }

  // Watered shimmer
  if (watered == 1) {
    float shimmer = 0.05 * sin(u_time * 3.0 + v_uv.y * 10.0);
    color.b += shimmer;
  }

  // Selection highlight
  if (selected == 1) {
    color.rgb = mix(color.rgb, vec3(1.0, 1.0, 0.5), 0.3);
  }

  gl_FragColor = color;
}
```

---

## Atlas UV Mapping Rules

- Atlas is a power-of-2 texture (e.g. 2048×2048)
- Each tile sprite occupies `(atlasW / cols) × (atlasH / rows)` pixels
- Tile index → column + row via integer division
- UV coordinates are normalized (0.0–1.0)
- Half-pixel offset applied to prevent bleeding between tiles

### Atlas Layout

```
[ 0][ 1][ 2][ 3] ...  ← ground tiles
[16][17][18][19] ...  ← crop stage 0–7 (per crop row)
[32][33]...           ← buildings
[48][49]...           ← decorations
```

---

## Animation Hooks

Animations are driven by `u_time` uniform (seconds elapsed).

| Effect         | Trigger           | Implementation              |
|----------------|-------------------|-----------------------------|
| Crop sway      | `animated` flag   | UV offset sine wave         |
| Water shimmer  | `watered` flag    | Blue channel oscillation    |
| Harvest glow   | stage 7           | Brightness pulse            |
| Building smoke | building active   | Particle sprite frame cycle |

Particle effects (smoke, sparkle) use a separate sprite sheet + instance layer. Not in MVP.

---

## Lighting System (Optional)

Post-MVP lighting via a second render pass:

1. Render world to color texture
2. Render light map (point lights → additive blend)
3. Composite: `finalColor = worldColor * lightMap`

Light sources: campfires, lanterns, crop glow (max stage).

Not required for MVP; shader stubs reserved.

---

## Shader Contracts

| Contract                      | Rule                                     |
|-------------------------------|------------------------------------------|
| No branching on tileId        | All tile variants handled via atlas UV   |
| No texture sampling in vertex | All texture work in fragment              |
| State flags max 8 bits        | Fits float precision for instanced data  |
| Atlas uniform never changes   | Bound once per frame, shared all draws   |
| u_time wraps at 3600s         | Avoids float precision drift             |
