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

### LivingEntity Inventory Caps (Phase 7.5)

Settlers, animals, and mounts share a `LivingEntity` base class that adds a small carry-cap surface. Per-instance fields so each subclass tunes its own budget.

| Field            | Type    | Default          | Notes                                       |
|------------------|---------|------------------|---------------------------------------------|
| `maxCarryWeight` | Uint16  | 0 (base) / 100 (Villager) | Total carried weight in deci-units (×10) |
| `maxStackSize`   | Uint8   | 99 (`MAX_STACK_SIZE`) | Per-itemId ceiling, hard upper bound 99      |
| `carriedItems`   | `Map<ItemId, count>` | empty | Item kinds + counts the entity is holding  |

A subclass that doesn't carry anything leaves `maxCarryWeight = 0` so `pickup()` refuses everything. Villager sets it to 100 in the constructor.

The 99-stack ceiling exists so any future typed-array inventory packs into a `Uint8` slot without overflow.

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

## Item Definition (Phase 4 + 7.5)

Items are the unit of trade and inventory. Item ids share the tile-id number space (seeds 600..699, raw produce 700..799, processed goods 800..899). Per-item registry lives in `src/state/items.ts`; runtime code never embeds item ids as constants.

```
ItemDef {
  id:            Uint16       // ItemId (number space documented above)
  name:          string       // internal lowercase name
  displayName:   string       // user-facing label
  basePrice:     Uint32       // coin cost / sell price (Phase 4 fixed; 4.5 multiplies)
  weight:        Uint16       // per-unit weight in deci-units (×10) — integer math
  defaultSticky: bool         // optional; auto-deposit always skips this item kind
}
```

### Weight Encoding

Weights are stored as integers in deci-units (×10) so `pickup` clamping never accumulates float drift across heterogeneous inventories. Display layers divide by 10 for kg-style output. Current values:

| Item                 | Weight (deci) | Notes                              |
|----------------------|---------------|------------------------------------|
| Seeds (any)          | 1             | `defaultSticky: true`              |
| Wheat / Carrot / Corn| 8–12          | One harvest fits a Villager (cap 100) |
| Bread                | 6             | Light enough to stack-haul         |
| Flour                | 25            | Sack-heavy; ≤4 fits a Villager     |

### Sticky Items

Two sources of stickiness compose into the auto-deposit exemption set (Phase 7.5):

1. **Item-level** — `ItemDef.defaultSticky = true`. Seeds use this so a freshly-fetched seed survives any auto-deposit between HAUL_SEED and PLANT_SEED.
2. **Job-level** — `Job.holdItems: ItemId[]`. Per-job override; HAUL_SEED writes `[seedId]` defensively, future Phase 8 haul jobs (e.g. mill→bakery flour) will use this for their non-default-sticky cargo.

The settler controller computes `sticky = defaultSticky | union(claimedJob.holdItems)` per tick when evaluating the deposit gate.

---

## Job Format (Phase 7 + 7.5)

Settlers consume jobs from a main-thread `JobBoard`. Job records are flat-shape; the kinds enum is the only branching dimension.

```
Job {
  id:               Uint32
  kind:             Uint8           // HAUL_WATER | WATER_CROP | HARVEST_CROP
                                    // | PLANT_SEED | HAUL_SEED
  source:           [Int16, Int16]  // tile to fetch from
  target:           [Int16, Int16]  // tile to deliver to
  priority:         Uint8           // higher wins, distance breaks ties
  claimedBy:        Uint32 | 0      // 0 = unclaimed
  payload:          ItemId | 0      // produce kind for HARVEST, seed for HAUL_SEED/PLANT_SEED
  lastProgressTime: Float32         // for stale-job detection
  holdItems:        ItemId[]?       // (Phase 7.5) sticky list — see Item Definition
}
```

`claim()` is a single-claim mutex — the closest unclaimed matching job wins. Stale jobs auto-cancel and re-emit on the next emitter scan if the underlying need is still real.

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
