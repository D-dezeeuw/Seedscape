// Base entity contract. Entities live outside the tile grid (sub-tile
// position via localX/localY floats) and tick on the main thread —
// independent of the per-chunk simulation worker. The base intentionally
// only handles position, type, facing, and the tick contract; behavior
// lives on subclasses (LivingEntity → Villager / Animal / Pet / Mount).
//
// Future-proofing notes:
//   • Storage today is a Map<id, Entity> in EntityManager. The public
//     surface (tick / pickAt / iterate) doesn't expose object identity,
//     so we can swap to typed-array-backed pools later (see docs/18) if
//     entity counts grow past ~64.
//   • LivingEntity carries placeholder slots for needs / memory / mood
//     so spawn sites don't need to change when those systems land.

import { CHUNK_SIZE } from "../../world/chunk";

export type EntityType = "villager" | "animal" | "pet" | "mount";

// Cardinal facing. Index aligns with sprite-row order in the entity
// atlas: 0=south (toward camera), 1=west, 2=north, 3=east.
export const FACING_SOUTH = 0;
export const FACING_WEST = 1;
export const FACING_NORTH = 2;
export const FACING_EAST = 3;
export type Facing = 0 | 1 | 2 | 3;

export interface EntityPosition {
  chunkX: number;
  chunkY: number;
  localX: number;
  localY: number;
}

// Per-tick context. Passed by EntityManager.tick() — entities use this
// to query the world (walkability, time, deterministic RNG seed) without
// importing chunk/manager directly. Keeps entities testable in isolation.
export interface EntityTickContext {
  // Wall-clock-equivalent game time (seconds, fractional). Increases
  // monotonically; pause halts.
  time: number;
  // Seconds since last entity tick — typically the rAF frame interval.
  dt: number;
  // World seed for deterministic per-entity RNG.
  worldSeed: number;
  // True if the given world tile is walkable for entities. Implementation
  // lives on the chunk side; we just consume the result here.
  isWalkable: (worldTileX: number, worldTileY: number) => boolean;
  // Current sim tick (Phase 4 sim ticks at 1Hz). Job emitters and
  // stuck-job timeouts use this — undefined when entities run in
  // isolation tests that don't tick the sim.
  simTick?: number;
  // Optional services for autonomous behaviour (Phase 7). When absent,
  // entities fall back to their pre-Phase-7 behaviour (settlers wander).
  // Defined as a forward-declared interface so this file doesn't need
  // imports from job/path modules.
  services?: EntityServices;
}

// Services that autonomous entities consume. Imported by Villager and
// future AI consumers (animals fleeing, deliveries). Kept generic so
// non-Villager entities don't have to construct unused fields.
export interface EntityServices {
  jobs?: import("../jobs").JobBoard;
  pathfinding?: import("../../workers/pathfinding_client").PathfindingClient;
  crates?: import("../../world/farming/crate").CrateStore;
  tileWorld?: TileWorldAccess;
}

// Minimal tile-world surface used by the state machine. Implemented by
// the live ChunkManager; tests inject a fake.
export interface TileWorldAccess {
  // Read tileId / state / metadata at a world tile, or null when the
  // chunk isn't loaded.
  readTile(
    worldTileX: number,
    worldTileY: number,
  ): { tileId: number; state: number; metadata: number } | null;
  // Apply a tile action by world coords. Returns whether it applied.
  // Implementations mark the chunk dirty internally.
  harvestAt(
    worldTileX: number,
    worldTileY: number,
  ): { applied: boolean; produceItem?: number; yield?: number };
  waterAt(worldTileX: number, worldTileY: number): boolean;
  // Plant a seed on an empty tilled tile. seedItem is the ItemId from
  // the player's seed range (600..699). Returns whether it applied
  // (false when the tile got planted by someone else mid-flight, etc.).
  plantSeedAt(worldTileX: number, worldTileY: number, seedItem: number): boolean;
  // Iterate loaded chunks (for emitter, water-finder, crate scans).
  allChunkRecords(): IterableIterator<[string, import("../../world/chunk").ChunkRecord]>;
}

export abstract class Entity {
  readonly id: number;
  abstract readonly type: EntityType;

  chunkX: number;
  chunkY: number;
  localX: number;
  localY: number;
  facing: Facing;

  constructor(id: number, position: EntityPosition, facing: Facing = FACING_SOUTH) {
    this.id = id;
    this.chunkX = position.chunkX;
    this.chunkY = position.chunkY;
    this.localX = position.localX;
    this.localY = position.localY;
    this.facing = facing;
  }

  // World-space sub-tile coords (for rendering and AI math).
  worldX(): number {
    return this.chunkX * CHUNK_SIZE + this.localX;
  }
  worldY(): number {
    return this.chunkY * CHUNK_SIZE + this.localY;
  }

  // Discrete tile under the entity (for picker / "what tile am I on").
  worldTileX(): number {
    return Math.floor(this.worldX());
  }
  worldTileY(): number {
    return Math.floor(this.worldY());
  }

  setWorldPosition(worldX: number, worldY: number): void {
    this.chunkX = Math.floor(worldX / CHUNK_SIZE);
    this.chunkY = Math.floor(worldY / CHUNK_SIZE);
    this.localX = worldX - this.chunkX * CHUNK_SIZE;
    this.localY = worldY - this.chunkY * CHUNK_SIZE;
  }

  // World-tile coords of the tile this entity is facing, `distance` tiles
  // ahead. Default 1 = the immediate neighbor. Subclasses can call with a
  // larger distance for long-bodied entities (mounts, future creatures)
  // whose "front" sits more than one tile out.
  facedTile(distance = 1): { x: number; y: number } {
    const tx = this.worldTileX();
    const ty = this.worldTileY();
    switch (this.facing) {
      case FACING_NORTH:
        return { x: tx, y: ty - distance };
      case FACING_SOUTH:
        return { x: tx, y: ty + distance };
      case FACING_EAST:
        return { x: tx + distance, y: ty };
      case FACING_WEST:
        return { x: tx - distance, y: ty };
    }
  }

  abstract tick(ctx: EntityTickContext): void;

  // Default click handler — subclasses override to react. Returns true if
  // the entity consumed the click (UI may suppress further handling).
  onSelect(): boolean {
    return false;
  }
}
