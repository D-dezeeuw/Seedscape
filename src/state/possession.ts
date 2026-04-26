// Possession state — single source of truth for "is the player driving an
// entity right now, and which one". Pure state container; no DOM, no input,
// no camera. The InputRouter and PossessionController consumers (camera
// follow, click guard, action key) all derive behavior from this.
//
// Two modes:
//   - god: free camera, mouse drives tools, WASD drives camera (the default)
//   - possess: camera follows entity, WASD drives entity, action key drives
//     tools against the entity's faced tile
//
// Transitions go through enter()/exit() so callers can subscribe to mode
// changes without polling.

import type { Entity } from "./entities/entity";

// World-space center of the tile an entity currently occupies. Entities
// store position as the bottom-left corner (worldX/worldY); rendering and
// camera follow want the visual center, which is +0.5 on both axes.
// Centralized here so the camera can't drift away from the visual disc
// because one call site forgot the offset.
export function entityCenter(entity: Entity): { x: number; y: number } {
  return { x: entity.worldX() + 0.5, y: entity.worldY() + 0.5 };
}

export type PossessionMode = "god" | "possess";

export interface PossessionSnapshot {
  mode: PossessionMode;
  entity: Entity | null;
}

export type PossessionListener = (snapshot: PossessionSnapshot) => void;

export class PossessionController {
  private _mode: PossessionMode = "god";
  private _entity: Entity | null = null;
  private readonly listeners = new Set<PossessionListener>();

  get mode(): PossessionMode {
    return this._mode;
  }

  get entity(): Entity | null {
    return this._entity;
  }

  isPossessing(): boolean {
    return this._mode === "possess" && this._entity !== null;
  }

  // Enter possess mode targeting the given entity. Idempotent for the
  // same entity; switching to a different entity transitions through
  // possess → possess (single fire, single listener call).
  enter(entity: Entity): void {
    if (this._mode === "possess" && this._entity === entity) return;
    this._mode = "possess";
    this._entity = entity;
    this.fire();
  }

  // Return to god mode. Idempotent.
  exit(): void {
    if (this._mode === "god" && this._entity === null) return;
    this._mode = "god";
    this._entity = null;
    this.fire();
  }

  // Called by callers that hold a possessed-entity reference and just
  // removed/destroyed it (e.g. entity unloaded with its chunk). Acts like
  // exit() but only when the dropped entity is the current one.
  forceReleaseIf(entity: Entity): void {
    if (this._entity === entity) this.exit();
  }

  subscribe(listener: PossessionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private fire(): void {
    const snap: PossessionSnapshot = { mode: this._mode, entity: this._entity };
    for (const listener of this.listeners) listener(snap);
  }
}
