# Seedscape — Networking Model

## Principle

The simulation is authoritative on the server. The client renders and inputs only. All game state derives from server tick output.

> This document defines the future multiplayer design. Networking is not in MVP scope but the architecture must not preclude it.

---

## Architecture

```
Client (browser)
  └─ Input events → Server
  └─ Receives: chunk deltas, entity updates

Server (Node.js)
  └─ Runs authoritative simulation
  └─ Sends: chunk deltas, entity states, economy updates
```

---

## Authority Rules

| System             | Authority     | Notes                              |
|--------------------|---------------|------------------------------------|
| Crop simulation    | Server        | Client predicts, server corrects   |
| Economy / pricing  | Server        | Client read-only                   |
| Player position    | Client        | Server validates range             |
| NPC orders         | Server        | Client displays only               |
| Inventory          | Server        | Client optimistic, server confirms |
| World generation   | Shared        | Deterministic — same result both sides |

---

## Chunk Sync Model

### Initial Load

When client enters a chunk for the first time:

1. Client requests chunk from server
2. Server sends full `ChunkPayload` (tileId + state + metadata arrays)
3. Client caches and renders

```
ChunkPayload {
  chunkX:   Int32
  chunkY:   Int32
  version:  Uint32      // monotonic change counter
  tileId:   Uint16[1024]
  state:    Uint8[1024]
  metadata: Uint8[1024]
}
```

### Ongoing Updates (Delta)

Server sends delta messages only for tiles that changed since last sync.

```
ChunkDelta {
  chunkX:    Int32
  chunkY:    Int32
  version:   Uint32
  count:     Uint16
  tiles[]:
    index:   Uint16
    tileId:  Uint16
    state:   Uint8
    metadata:Uint8
}
```

Client applies delta to cached chunk. If version gap detected → request full resync.

---

## Event-Based Replication

Non-tile events sent as typed messages:

| Event type         | Direction      | Payload                          |
|--------------------|----------------|----------------------------------|
| PlayerAction       | Client → Server| action type, tile target, item   |
| HarvestResult      | Server → Client| itemId, quantity, xp gained      |
| OrderUpdate        | Server → Client| NPC order list delta             |
| PriceUpdate        | Server → Client| itemId, new price                |
| LevelUp            | Server → Client| new level, unlocks granted       |
| ChunkDelta         | Server → Client| see above                        |
| EntityMove         | Server → Client| entityId, position, state        |

---

## Sync Cadence

| Data type         | Update rate      |
|-------------------|-----------------|
| Chunk deltas      | Per sim tick (5–20 TPS) |
| Entity positions  | 10 Hz           |
| Economy prices    | Every 30s       |
| NPC orders        | Every 60s       |
| Player inventory  | On change       |

---

## Chunk Subscription Model

Client subscribes to chunks in its visible + simulation range. Server only sends deltas for subscribed chunks.

```
Subscribe:   { chunkX, chunkY }
Unsubscribe: { chunkX, chunkY }
```

Server maintains per-connection subscription list. Chunks outside subscription are not transmitted.

---

## Latency Handling

| Technique            | Applied to                       |
|----------------------|----------------------------------|
| Client prediction    | Player movement, tile interaction|
| Server reconciliation| Inventory, crop state            |
| Optimistic UI        | Harvest, planting actions        |
| Delta versioning     | Chunk resync on gap detection    |

---

## Single-Player Mode

In single-player (offline / local), the server simulation runs in a shared worker or on the main thread.

Same message protocol used — transport is in-process instead of WebSocket.

This allows the codebase to stay network-agnostic at the simulation layer.
