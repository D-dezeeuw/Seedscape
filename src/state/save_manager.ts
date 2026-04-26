// Snapshot the parts of game state that need to survive page reload, and
// restore them on next boot. Saves only DIRTY_SIMULATION chunks; pristine
// generated chunks regenerate identically from worldSeed.

import type { Camera } from "../input/camera";
import type { IoClient } from "../workers/io_client";
import type { ChunkManager } from "../world/chunk_manager";
import type { EntityManager } from "./entities/entity_manager";
import { deserializeEntity, type SavedEntity, serializeEntity } from "./entities/persistence";
import type { Inventory } from "./inventory";
import type { NpcOrder, OrderBook } from "./orders";
import type { Player, PlayerSnapshot } from "./player";

// 1 → 2 (Phase 4): added orders + gameTimeSec.
// 2 → 3 (Phase 5): added entities (Villager / Pet / Mount).
// 3 → 4 (Worldgen v2): pipeline rewrite — pristine chunks would re-
//   generate against new tile shapes, leaving player-modified chunks
//   visually disjoint at their borders. Cleanest is to drop legacy
//   saves so the world re-emerges coherent.
// Older saves are dropped on load.
export const SAVE_VERSION = 4;

export interface SavedChunk {
  chunkX: number;
  chunkY: number;
  tileId: Uint16Array;
  state: Uint8Array;
  metadata: Uint8Array;
}

export interface Snapshot {
  version: number;
  worldSeed: number;
  camera: { x: number; y: number; zoom: number };
  player: PlayerSnapshot;
  inventory: Record<number, number>;
  chunks: SavedChunk[];
  orders: { orders: NpcOrder[]; nextRefreshSec: number };
  // Wall-clock seconds since the world started (game time, not real time).
  // Lets the order book know how to schedule next refresh on load.
  gameTimeSec: number;
  entities: SavedEntity[];
}

export interface SaveManagerDeps {
  io: IoClient;
  worldSeed: number;
  camera: Camera;
  player: Player;
  inventory: Inventory;
  chunkManager: ChunkManager;
  orders: OrderBook;
  entityManager: EntityManager;
  // Function returning the current game-time-seconds when called.
  gameTimeSec: () => number;
}

export class SaveManager {
  private readonly deps: SaveManagerDeps;

  constructor(deps: SaveManagerDeps) {
    this.deps = deps;
  }

  buildSnapshot(): Snapshot {
    const chunks: SavedChunk[] = [];
    for (const { chunkX, chunkY, data } of this.deps.chunkManager.dirtySimChunks()) {
      chunks.push({
        chunkX,
        chunkY,
        tileId: new Uint16Array(data.tileId),
        state: new Uint8Array(data.state),
        metadata: new Uint8Array(data.metadata),
      });
    }
    const entities: SavedEntity[] = [];
    for (const e of this.deps.entityManager.iterate()) entities.push(serializeEntity(e));
    return {
      version: SAVE_VERSION,
      worldSeed: this.deps.worldSeed,
      camera: { x: this.deps.camera.x, y: this.deps.camera.y, zoom: this.deps.camera.zoom },
      player: this.deps.player.toJSON(),
      inventory: this.deps.inventory.toJSON(),
      chunks,
      orders: this.deps.orders.toJSON(),
      gameTimeSec: this.deps.gameTimeSec(),
      entities,
    };
  }

  async save(): Promise<void> {
    const snapshot = this.buildSnapshot();
    await this.deps.io.save(snapshot);
    for (const c of snapshot.chunks) {
      this.deps.chunkManager.clearSimulationDirty(c.chunkX, c.chunkY);
    }
  }

  async load(): Promise<Snapshot | null> {
    const raw = await this.deps.io.load<Snapshot>();
    if (!raw) return null;
    if (raw.version !== SAVE_VERSION) {
      console.warn(
        `save version mismatch (got ${raw.version}, expected ${SAVE_VERSION}); ignoring`,
      );
      return null;
    }
    return raw;
  }

  applySnapshot(snapshot: Snapshot): void {
    this.deps.camera.x = snapshot.camera.x;
    this.deps.camera.y = snapshot.camera.y;
    this.deps.camera.zoom = snapshot.camera.zoom;
    this.deps.player.loadFromJSON(snapshot.player);
    this.deps.inventory.loadFromJSON(snapshot.inventory);
    this.deps.orders.loadFromJSON(snapshot.orders);
    for (const c of snapshot.chunks) {
      this.deps.chunkManager.preloadChunk(c.chunkX, c.chunkY, {
        tileId: c.tileId,
        state: c.state,
        metadata: c.metadata,
      });
    }
    for (const saved of snapshot.entities) {
      this.deps.entityManager.add(deserializeEntity(saved));
    }
  }
}
