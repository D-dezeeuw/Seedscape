// Tile info panel — shows what's under the mouse cursor. Polls the chunk
// manager on pointermove (rate-limited via rAF). Bottom-right corner so it
// doesn't compete with the toolbar.

import type { Camera } from "../input/camera";
import { pickTile } from "../input/picker";
import { tileIndex } from "../world/chunk";
import type { ChunkManager } from "../world/chunk_manager";
import {
  CROP_STAGE_HARVESTABLE,
  CROP_STATE_WILTED,
  cropForTile,
} from "../world/farming/crop_registry";
import { getWaterLevel } from "../world/farming/tile_actions";

interface TileInfoDeps {
  parent: HTMLElement;
  canvas: HTMLCanvasElement;
  camera: Camera;
  chunkManager: ChunkManager;
  tileWorldSize: number;
}

const TILE_NAMES: Record<number, string> = {
  0: "Shallow Water",
  1: "Deep Water",
  10: "Dry Grass",
  11: "Rich Soil",
  12: "Untilled Farmland",
  13: "Tilled Farmland",
  20: "Rocky Outcrop",
};

function describeTile(tileId: number, state: number): string {
  const crop = cropForTile(tileId);
  if (crop) {
    if (state === CROP_STATE_WILTED) return `${crop.displayName} (wilted)`;
    if (state >= CROP_STAGE_HARVESTABLE) return `${crop.displayName} (ready)`;
    return `${crop.displayName} (stage ${state}/${CROP_STAGE_HARVESTABLE})`;
  }
  return TILE_NAMES[tileId] ?? `Tile ${tileId}`;
}

export function createTileInfo(deps: TileInfoDeps): () => void {
  const panel = document.createElement("div");
  panel.className = "ss-panel ss-info";
  panel.innerHTML = `
    <h3>Tile</h3>
    <div data-field="body"><div class="ss-empty">hover a tile</div></div>
  `;
  deps.parent.appendChild(panel);
  const body = panel.querySelector('[data-field="body"]') as HTMLDivElement;

  let dirty = false;
  let lastClientX = -1;
  let lastClientY = -1;

  const renderBody = (): void => {
    if (lastClientX < 0) return;
    const rect = deps.canvas.getBoundingClientRect();
    const px = lastClientX - rect.left;
    const py = lastClientY - rect.top;
    if (px < 0 || py < 0 || px > rect.width || py > rect.height) {
      body.innerHTML = `<div class="ss-empty">hover a tile</div>`;
      return;
    }
    const pick = pickTile(
      px,
      py,
      deps.canvas.clientWidth,
      deps.canvas.clientHeight,
      deps.camera.x,
      deps.camera.y,
      deps.camera.zoom,
      deps.tileWorldSize,
    );
    const record = deps.chunkManager.peekChunk(pick.chunkX, pick.chunkY);
    if (!record) {
      body.innerHTML = `
        <div class="ss-row"><span>World</span><span>${pick.worldTileX}, ${pick.worldTileY}</span></div>
        <div class="ss-empty">loading…</div>
      `;
      return;
    }
    const i = tileIndex(pick.localX, pick.localY);
    const tileId = record.data.tileId[i] ?? 0;
    const state = record.data.state[i] ?? 0;
    const meta = record.data.metadata[i] ?? 0;
    body.innerHTML = `
      <div class="ss-row"><span>World</span><span>${pick.worldTileX}, ${pick.worldTileY}</span></div>
      <div class="ss-row"><span>Chunk</span><span>${pick.chunkX}, ${pick.chunkY}</span></div>
      <div class="ss-row"><span>Type</span><span>${describeTile(tileId, state)}</span></div>
      <div class="ss-row"><span>Water</span><span>${getWaterLevel(meta)}/3</span></div>
    `;
  };

  const onMove = (e: PointerEvent): void => {
    lastClientX = e.clientX;
    lastClientY = e.clientY;
    if (!dirty) {
      dirty = true;
      requestAnimationFrame(() => {
        dirty = false;
        renderBody();
      });
    }
  };
  const onLeave = (): void => {
    lastClientX = -1;
    body.innerHTML = `<div class="ss-empty">hover a tile</div>`;
  };

  deps.canvas.addEventListener("pointermove", onMove);
  deps.canvas.addEventListener("pointerleave", onLeave);

  return () => {
    deps.canvas.removeEventListener("pointermove", onMove);
    deps.canvas.removeEventListener("pointerleave", onLeave);
    panel.remove();
  };
}
