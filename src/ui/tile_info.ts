// Tile info panel — shows what's under the mouse cursor. Polls the chunk
// manager on pointermove (rate-limited via rAF). Bottom-right corner so it
// doesn't compete with the toolbar.

import type { Camera } from "../input/camera";
import { pickTile } from "../input/picker";
import type { EntityManager } from "../state/entities/entity_manager";
import { Villager } from "../state/entities/villager";
import { tileIndex } from "../world/chunk";
import type { ChunkManager } from "../world/chunk_manager";
import { buildingForTile, getQueuedJobs } from "../world/farming/building_registry";
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
  // Optional — when supplied, the panel adds an "Entity" row whenever
  // an entity sits on the hovered tile.
  entityManager?: EntityManager;
}

// Mirrors the `ground` array in data/tiles.json. Worldgen-v2 added 22
// and 25; future biomes (Stoneveil 23/24, Sunfen 30-33, Voidsoil 40-42)
// already have entries so they show up correctly the moment generation
// starts producing them.
const TILE_NAMES: Record<number, string> = {
  0: "Shallow Water",
  1: "Deep Water",
  10: "Dry Grass",
  11: "Rich Soil",
  12: "Untilled Farmland",
  13: "Tilled Farmland",
  20: "Rocky Outcrop",
  21: "Rocky Soil",
  22: "Barren Stone",
  23: "Cliff Face",
  24: "Gravel",
  25: "Beach Sand",
  30: "Swamp Water",
  31: "Mudflat",
  32: "Deltaic Soil",
  33: "Raised Grassland",
  40: "Cracked Void Earth",
  41: "Ashen Soil",
  42: "Obsidian Formation",
};

function describeTile(tileId: number, state: number): string {
  const crop = cropForTile(tileId);
  if (crop) {
    if (state === CROP_STATE_WILTED) return `${crop.displayName} (wilted)`;
    if (state >= CROP_STAGE_HARVESTABLE) return `${crop.displayName} (ready)`;
    return `${crop.displayName} (stage ${state}/${CROP_STAGE_HARVESTABLE})`;
  }
  const building = buildingForTile(tileId);
  if (building) return building.displayName;
  return TILE_NAMES[tileId] ?? `Tile ${tileId}`;
}

// Two presentational modes the panel toggles between based on hover state:
//   "empty" — cursor off-canvas, no tile selected
//   "loading" — tile in an unloaded chunk; world coords known, type not
//   "loaded" — full row set
// Building vs non-building swaps two rows (Status+Queue ↔ Water); we keep
// all of them in the DOM and toggle display rather than re-mounting.
interface PanelRefs {
  empty: HTMLDivElement;
  loaded: HTMLDivElement;
  world: HTMLSpanElement;
  chunk: HTMLSpanElement;
  type: HTMLSpanElement;
  // Building-only rows (visible only on building tiles)
  statusRow: HTMLDivElement;
  status: HTMLSpanElement;
  queueRow: HTMLDivElement;
  queue: HTMLSpanElement;
  // Non-building rows
  waterRow: HTMLDivElement;
  water: HTMLSpanElement;
  // Optional entity row
  entityRow: HTMLDivElement;
  entity: HTMLSpanElement;
  loadingMessage: HTMLDivElement;
}

function buildPanel(parent: HTMLElement): { panel: HTMLElement; refs: PanelRefs } {
  const panel = document.createElement("div");
  panel.className = "ss-panel ss-info";
  panel.innerHTML = `
    <h3>Tile</h3>
    <div data-field="empty" class="ss-empty">hover a tile</div>
    <div data-field="loaded" style="display:none">
      <div class="ss-row"><span>World</span><span data-field="world"></span></div>
      <div class="ss-row"><span>Chunk</span><span data-field="chunk"></span></div>
      <div class="ss-row"><span>Type</span><span data-field="type"></span></div>
      <div data-field="loadingMessage" class="ss-empty" style="display:none">loading…</div>
      <div data-field="statusRow" class="ss-row" style="display:none"><span>Status</span><span data-field="status"></span></div>
      <div data-field="queueRow" class="ss-row" style="display:none"><span>Queue</span><span data-field="queue"></span></div>
      <div data-field="waterRow" class="ss-row" style="display:none"><span>Water</span><span data-field="water"></span></div>
      <div data-field="entityRow" class="ss-row" style="display:none"><span>Entity</span><span data-field="entity"></span></div>
    </div>
  `;
  parent.appendChild(panel);
  const q = <T extends HTMLElement>(name: string): T =>
    panel.querySelector(`[data-field="${name}"]`) as T;
  const refs: PanelRefs = {
    empty: q<HTMLDivElement>("empty"),
    loaded: q<HTMLDivElement>("loaded"),
    world: q<HTMLSpanElement>("world"),
    chunk: q<HTMLSpanElement>("chunk"),
    type: q<HTMLSpanElement>("type"),
    statusRow: q<HTMLDivElement>("statusRow"),
    status: q<HTMLSpanElement>("status"),
    queueRow: q<HTMLDivElement>("queueRow"),
    queue: q<HTMLSpanElement>("queue"),
    waterRow: q<HTMLDivElement>("waterRow"),
    water: q<HTMLSpanElement>("water"),
    entityRow: q<HTMLDivElement>("entityRow"),
    entity: q<HTMLSpanElement>("entity"),
    loadingMessage: q<HTMLDivElement>("loadingMessage"),
  };
  return { panel, refs };
}

function setText(el: HTMLElement, value: string): void {
  if (el.textContent !== value) el.textContent = value;
}

function show(el: HTMLElement, visible: boolean): void {
  const next = visible ? "" : "none";
  if (el.style.display !== next) el.style.display = next;
}

export function createTileInfo(deps: TileInfoDeps): () => void {
  const { panel, refs } = buildPanel(deps.parent);

  let dirty = false;
  let lastClientX = -1;
  let lastClientY = -1;

  const showEmpty = (): void => {
    show(refs.empty, true);
    show(refs.loaded, false);
  };

  const renderBody = (): void => {
    if (lastClientX < 0) {
      showEmpty();
      return;
    }
    const rect = deps.canvas.getBoundingClientRect();
    const px = lastClientX - rect.left;
    const py = lastClientY - rect.top;
    if (px < 0 || py < 0 || px > rect.width || py > rect.height) {
      showEmpty();
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

    show(refs.empty, false);
    show(refs.loaded, true);
    setText(refs.world, `${pick.worldTileX}, ${pick.worldTileY}`);
    setText(refs.chunk, `${pick.chunkX}, ${pick.chunkY}`);

    const record = deps.chunkManager.peekChunk(pick.chunkX, pick.chunkY);
    if (!record) {
      // Loading state — show coords + a loading message; hide everything
      // tile-content-specific until the chunk arrives.
      show(refs.loadingMessage, true);
      setText(refs.type, "—");
      show(refs.statusRow, false);
      show(refs.queueRow, false);
      show(refs.waterRow, false);
      show(refs.entityRow, false);
      return;
    }
    show(refs.loadingMessage, false);

    const i = tileIndex(pick.localX, pick.localY);
    const tileId = record.data.tileId[i] ?? 0;
    const state = record.data.state[i] ?? 0;
    const meta = record.data.metadata[i] ?? 0;
    const building = buildingForTile(tileId);

    setText(refs.type, describeTile(tileId, state));

    if (building) {
      const status = state === 0 ? "idle" : `${state}/${building.cycleTime}s`;
      setText(refs.status, status);
      setText(refs.queue, `${getQueuedJobs(meta)}/${building.queueSize}`);
      show(refs.statusRow, true);
      show(refs.queueRow, true);
      show(refs.waterRow, false);
    } else {
      setText(refs.water, `${getWaterLevel(meta)}/3`);
      show(refs.statusRow, false);
      show(refs.queueRow, false);
      show(refs.waterRow, true);
    }

    if (deps.entityManager) {
      const entity = deps.entityManager.pickAt(pick.worldTileX + 0.5, pick.worldTileY + 0.5, 0.6);
      if (entity) {
        const label = entity instanceof Villager ? entity.name : entity.type;
        setText(refs.entity, label);
        show(refs.entityRow, true);
      } else {
        show(refs.entityRow, false);
      }
    } else {
      show(refs.entityRow, false);
    }
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
    showEmpty();
  };

  deps.canvas.addEventListener("pointermove", onMove);
  deps.canvas.addEventListener("pointerleave", onLeave);

  return () => {
    deps.canvas.removeEventListener("pointermove", onMove);
    deps.canvas.removeEventListener("pointerleave", onLeave);
    panel.remove();
  };
}
