# Seedscape — Data Model

## Principle

All world state is encoded in compact typed arrays. No plain objects at runtime.

---

## Chunk Format (CPU)

A chunk is a 32×32 tile grid (1024 tiles).

```
ChunkData {
  tileId:   Uint16Array[1024]   // tile type identifier
  state:    Uint8Array[1024]    // growth stage / machine state / flags
  metadata: Uint8Array[1024]    // auxiliary data (water, fertility, variant)
}
```

### Coordinates

- Local: `(x, y)` within chunk (0–31)
- World: `(chunkX * 32 + localX, chunkY * 32 + localY)`
- Index: `y * 32 + x`

---

## Tile Encoding

### tileId (Uint16)

Bits 0–15 identify the tile type.

| Range     | Category            |
|-----------|---------------------|
| 0–99      | Ground / terrain    |
| 100–199   | Crop tiles          |
| 200–299   | Production buildings|
| 300–399   | Decorations         |
| 400–499   | Animals             |
| 500+      | Reserved            |

### state (Uint8)

Multipurpose per tile type:

| Tile type    | state meaning              |
|--------------|----------------------------|
| Crop         | Growth stage (0–7)         |
| Building     | Production queue progress  |
| Animal       | Hunger / happiness level   |
| Ground       | Moisture / soil quality    |

### metadata (Uint8)

Auxiliary flags and variant data. Bit layout varies per tile type.

```
Crop metadata:
  bits 0–2: fertilizer level (0–7)
  bits 3–4: water level (0–3)
  bits 5–7: seed variant (0–7)
```

---

## Entity Format

Entities (NPCs, animals, players) live outside the tile grid.

```
Entity {
  id:       Uint32       // unique entity ID
  type:     Uint8        // entity type enum
  chunkX:   Int16        // current chunk X
  chunkY:   Int16        // current chunk Y
  localX:   Float32      // sub-tile position X
  localY:   Float32      // sub-tile position Y
  state:    Uint8        // behavior state machine
  data:     Uint8[8]     // type-specific payload
}
```

---

## Chunk State Flags

```
ChunkFlags {
  DIRTY_SIMULATION: 0x01   // simulation data changed
  DIRTY_RENDER:     0x02   // GPU buffer needs rebuild
  GENERATED:        0x04   // world gen complete
  CACHED:           0x08   // in memory LRU cache
  ACTIVE:           0x10   // within simulation range
}
```

---

## Save Format

Minimal serialized form for persistence.

```
SavedChunk {
  version:  Uint8
  chunkX:   Int32
  chunkY:   Int32
  tileId:   Uint16[1024]
  state:    Uint8[1024]
  metadata: Uint8[1024]
}
```

Total uncompressed: ~3.1 KB per chunk. Compresses well (run-length or LZ).

---

## GPU Instance Buffer

Per-tile instance data uploaded to GPU per chunk.

```
InstanceBuffer (per tile) {
  worldX:     Float32
  worldY:     Float32
  tileIndex:  Float32   // atlas lookup
  stateFlags: Float32   // packed render state
}
```

Stride: 16 bytes × 1024 tiles = 16 KB per chunk.

---

## Network Sync Format (Future)

Delta-based chunk updates only. Full chunks sent on initial load.

```
ChunkDelta {
  chunkX:    Int32
  chunkY:    Int32
  tileCount: Uint16
  tiles[]:
    index:    Uint16
    tileId:   Uint16
    state:    Uint8
    metadata: Uint8
}
```
