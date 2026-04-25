# Seedscape — Rendering Pipeline

## Pipeline Overview

World State → Chunk Visibility → Worker Mesh Build → GPU Upload → Instanced Rendering → Fragment Shader

---

## Rendering Model

- 1 tile = 1 instance
- 1 chunk = 1 draw call
- Shared quad geometry

---

## Texture Atlas

Single texture containing all tile sprites.

UV mapping:

tileX = mod(index, width)
tileY = floor(index / width)

---

## Vertex Shader Responsibilities

- Transform tile position
- Compute atlas UV
- Pass state to fragment shader

---

## Fragment Shader Responsibilities

- Sample atlas texture
- Apply state-based effects
- Optional lighting layer

---

## Chunk Rendering Rules

- Only visible chunks rendered
- Dirty chunks rebuild buffers
- No per-frame per-tile updates

---

## Performance Constraints

- <200 draw calls/frame
- 50K–200K visible tiles
- Chunk upload <10ms target

---

## Camera System

- Floating origin system
- Chunk-relative coordinates
- No precision drift at scale
