// Snapshot the parts of game state that need to survive page reload, and
// restore them on next boot. Saves only DIRTY_SIMULATION chunks; pristine
// generated chunks regenerate identically from worldSeed.

import type { Camera } from "../input/camera";
import type { IoClient } from "../workers/io_client";
import type { ChunkManager } from "../world/chunk_manager";
import type { BuildingBufferSnapshot, BuildingBufferStore } from "../world/farming/building_buffer";
import type { CrateContentsSnapshot, CrateStore } from "../world/farming/crate";
import type { EntityManager } from "./entities/entity_manager";
import { deserializeEntity, type SavedEntity, serializeEntity } from "./entities/persistence";
import type { Inventory } from "./inventory";
import type { OrderBook, OrderBookSnapshot } from "./orders";
import type { Player, PlayerSnapshot } from "./player";
import type { PossessionController } from "./possession";

// 1 → 2 (Phase 4): added orders + gameTimeSec.
// 2 → 3 (Phase 5): added entities (Villager / Pet / Mount).
// 3 → 4 (Worldgen v2): pipeline rewrite — pristine chunks would re-
//   generate against new tile shapes, leaving player-modified chunks
//   visually disjoint at their borders. Cleanest is to drop legacy
//   saves so the world re-emerges coherent.
// 4 → 5 (Phase 6): added possessedEntityId so reloads resume possession.
// 5 → 6 (Phase 6 cleanup): OrderBook snapshot now carries rngSeed +
//   rotationOffset so post-load refreshes match the sequence that
//   would have run without a save/load round-trip.
// 6 → 7 (Phase 5 cleanup): Mount snapshot persists ridden + riderId so
//   saving mid-ride doesn't silently dismount the rider on load.
// 7 → 8 (Phase 7): villager waterReserve + carriedItems, crate contents.
//   Job state itself isn't persisted — settlers reset to idle on load and
//   the emitter rebuilds the board from current world state on first tick.
// 8 → 9: villager.gender, paired with the first name in data/names.json.
//   Bumped on principle even though deserialize tolerates missing values
//   (defaults to "male") — keeping the version monotonic for any future
//   migration tooling.
// 9 → 10 (Phase 8): per-building input/output buffers. Buildings now hold
//   cargo-in-flight (settlers feed them, settlers haul outputs) instead of
//   the player feeding/collecting through their inventory. Snapshots gain
//   `buildingBuffers`; missing snapshots load as empty (any prior queued
//   cycles drain naturally and the player can use the building window).
// 10 → 11 (Phase 9): farm animals (Chicken, Cow) ship as concrete species.
//   Their entity payload (`animal` field on SavedEntity) carries species +
//   pen anchor + hunger + produceProgress. Older saves never wrote that
//   field — the deserializer threw on the abstract case — so bumping
//   forces a clean v11 load instead of a half-deserialized world.
// Older saves are dropped on load.
export const SAVE_VERSION = 11;

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
  orders: OrderBookSnapshot;
  // Wall-clock seconds since the world started (game time, not real time).
  // Lets the order book know how to schedule next refresh on load.
  gameTimeSec: number;
  entities: SavedEntity[];
  // Id of the entity the player was possessing at save time, or null.
  // Restored after entities are deserialized so the camera can re-attach.
  possessedEntityId: number | null;
  // Storage crate contents per world tile. Empty object on a fresh world.
  crates: CrateContentsSnapshot;
  // Per-building input/output buffers (Phase 8). Empty {input:{},output:{}}
  // on a fresh world or one with no buildings yet.
  buildingBuffers: BuildingBufferSnapshot;
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
  possession: PossessionController;
  crates: CrateStore;
  buildingBuffers: BuildingBufferStore;
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
      possessedEntityId: this.deps.possession.entity?.id ?? null,
      crates: this.deps.crates.toJSON(),
      buildingBuffers: this.deps.buildingBuffers.toJSON(),
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
    this.deps.crates.loadFromJSON(snapshot.crates);
    // Older snapshots that pre-date Phase 8 land here without
    // `buildingBuffers` — version mismatch already drops them at
    // load(), but defensively tolerate a missing field.
    if (snapshot.buildingBuffers) {
      this.deps.buildingBuffers.loadFromJSON(snapshot.buildingBuffers);
    }
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
    // Resume possession if we had any. Done after entities are loaded so
    // the lookup hits the deserialized instance, and after camera coords
    // are restored so the saved camera position is the starting point
    // for the follow lerp (no jarring snap on load).
    if (snapshot.possessedEntityId !== null) {
      const ent = this.deps.entityManager.getById(snapshot.possessedEntityId);
      if (ent) this.deps.possession.enter(ent);
    }
  }
}
