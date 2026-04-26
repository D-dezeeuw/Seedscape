// Convert mouse / pointer screen coordinates into world tile coordinates,
// then into (chunkX, chunkY, localX, localY) for the chunk system.
//
// Pure math — no DOM, no event handling. Caller passes the canvas size and
// camera state in. Tested in picker.test.ts.

import { CHUNK_SIZE } from "../world/chunk";

export interface PickResult {
  worldTileX: number;
  worldTileY: number;
  chunkX: number;
  chunkY: number;
  localX: number;
  localY: number;
}

export function pickTile(
  screenX: number,
  screenY: number,
  canvasWidth: number,
  canvasHeight: number,
  cameraX: number,
  cameraY: number,
  cameraZoom: number,
  tileWorldSize: number,
): PickResult {
  // Screen → camera-relative world units (zoom is world-units-per-pixel).
  // Origin: screen center; +X right, +Y up (screen Y is inverted).
  const cameraRelX = (screenX - canvasWidth / 2) * cameraZoom;
  const cameraRelY = (canvasHeight / 2 - screenY) * cameraZoom;
  const worldX = cameraX + cameraRelX;
  const worldY = cameraY + cameraRelY;

  const worldTileX = Math.floor(worldX / tileWorldSize);
  const worldTileY = Math.floor(worldY / tileWorldSize);

  const chunkX = Math.floor(worldTileX / CHUNK_SIZE);
  const chunkY = Math.floor(worldTileY / CHUNK_SIZE);

  // Modulo that handles negative tile coords correctly: -1 → CHUNK_SIZE-1.
  const localX = ((worldTileX % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const localY = ((worldTileY % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;

  return { worldTileX, worldTileY, chunkX, chunkY, localX, localY };
}

// Same conversion but starting from world-tile coords (e.g. an entity's
// facedTile()). Used by the action-key path to address the same tile data
// the click picker would.
export function worldTileToPick(worldTileX: number, worldTileY: number): PickResult {
  const chunkX = Math.floor(worldTileX / CHUNK_SIZE);
  const chunkY = Math.floor(worldTileY / CHUNK_SIZE);
  const localX = ((worldTileX % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const localY = ((worldTileY % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  return { worldTileX, worldTileY, chunkX, chunkY, localX, localY };
}
