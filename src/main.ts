import { createGLContext, resizeCanvasToDisplaySize, WebGL2UnsupportedError } from "./core/canvas";
import { createFpsOverlay } from "./core/fps";
import { Camera } from "./input/camera";
import { attachCameraControls } from "./input/camera_controls";
import { attachTileInteraction } from "./input/tile_interaction";
import { ToolState } from "./input/tool";
import { type AtlasManifest, loadAtlas } from "./rendering/atlas";
import { InstancedTileRenderer } from "./rendering/instanced_tile_renderer";
import { Inventory } from "./state/inventory";
import { ITEM_IDS } from "./state/items";
import { OrderBook } from "./state/orders";
import { Player } from "./state/player";
import { SaveManager } from "./state/save_manager";
import { newUnlocksAtLevel } from "./state/unlocks";
import { createDebugPanel } from "./ui/debug_panel";
import { createHud } from "./ui/hud";
import { createInventoryPanel } from "./ui/inventory_panel";
import { createOrdersPanel } from "./ui/orders_panel";
import { createSettingsPanel } from "./ui/settings_panel";
import { createShopMenu } from "./ui/shop_menu";
import { injectUiStyles } from "./ui/styles";
import { createTileInfo } from "./ui/tile_info";
import { createToaster } from "./ui/toast";
import { createToolbar, type ToolbarWindow } from "./ui/toolbar";
import { GenerationPool } from "./workers/generation_pool";
import { IoClient } from "./workers/io_client";
import { SimulationPool } from "./workers/simulation_pool";
import {
  CHUNK_FLAG_DIRTY_RENDER,
  CHUNK_FLAG_DIRTY_SIMULATION,
  type ChunkRecord,
  tileIndex,
} from "./world/chunk";
import { ChunkManager } from "./world/chunk_manager";
import { visibleChunkRect } from "./world/coords";
import { applySimDelta } from "./world/farming/sim_pipeline";

const TILE_WORLD_SIZE = 1.0;
const WORLD_SEED = 0xc0ffee;
const CACHE_CAPACITY = 256;
const STREAM_MARGIN_CHUNKS = 2;
const SIM_TICK_MS = 1000;
const AUTOSAVE_MS = 30_000;
const STARTING_WHEAT_SEEDS = 100;
// Production XP per output unit emitted by a building cycle. Keeps level
// progression tied to actually running the chain, not just selling.
const PRODUCTION_XP_PER_OUTPUT = 2;

const ATLAS_MANIFEST: AtlasManifest = {
  textureSize: 2048,
  tileSize: 32,
  tilesPerRow: 64,
};

function showUnsupportedMessage(): void {
  const banner = document.createElement("div");
  banner.style.cssText =
    "position:fixed;inset:0;display:grid;place-items:center;background:#1a262e;color:#e8eaed;font:16px/1.4 system-ui,sans-serif;padding:2rem;text-align:center;";
  banner.textContent =
    "Seedscape requires a browser with WebGL2 support. Please update your browser to continue.";
  document.body.replaceChildren(banner);
}

function showFatalError(err: unknown): void {
  const banner = document.createElement("pre");
  banner.style.cssText =
    "position:fixed;inset:0;margin:0;padding:2rem;background:#1a262e;color:#ff8a8a;font:13px/1.4 ui-monospace,monospace;white-space:pre-wrap;overflow:auto;";
  banner.textContent = `Seedscape failed to start.\n\n${err instanceof Error ? (err.stack ?? err.message) : String(err)}`;
  document.body.replaceChildren(banner);
}

async function bootstrap(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>("#seedscape-canvas");
  if (!canvas) throw new Error("Missing #seedscape-canvas element in DOM.");

  let gl: WebGL2RenderingContext;
  try {
    gl = createGLContext(canvas);
  } catch (err) {
    if (err instanceof WebGL2UnsupportedError) {
      showUnsupportedMessage();
      return;
    }
    throw err;
  }

  injectUiStyles();

  const atlas = await loadAtlas(gl, "/atlas.png", ATLAS_MANIFEST);
  const renderer = new InstancedTileRenderer(gl, atlas, TILE_WORLD_SIZE);
  const generationPool = new GenerationPool(WORLD_SEED);
  await generationPool.ready();
  const chunkManager = new ChunkManager({
    pool: generationPool,
    renderer,
    cacheCapacity: CACHE_CAPACITY,
  });
  const simulationPool = new SimulationPool();
  const ioClient = new IoClient();

  const camera = new Camera();
  camera.x = 0;
  camera.y = 0;

  const player = new Player();
  const inventory = new Inventory();
  inventory.add(ITEM_IDS.WHEAT_SEED, STARTING_WHEAT_SEEDS);
  const orders = new OrderBook(0);

  // Game time: advances 1 second per sim tick. Stored separately from
  // `tick` so save/load can preserve it across sessions.
  let gameTimeSec = 0;

  const saveManager = new SaveManager({
    io: ioClient,
    worldSeed: WORLD_SEED,
    camera,
    player,
    inventory,
    chunkManager,
    orders,
    gameTimeSec: () => gameTimeSec,
  });

  const existingSave = await saveManager.load();
  if (existingSave) {
    saveManager.applySnapshot(existingSave);
    gameTimeSec = existingSave.gameTimeSec;
  }
  // Prime an order list either way (refreshes immediately at gameTimeSec=0
  // on a fresh world; on load the saved nextRefreshSec drives the schedule).
  orders.tick(gameTimeSec);

  const detachControls = attachCameraControls(camera, canvas);
  const tool = new ToolState();

  const detachInteraction = attachTileInteraction({
    canvas,
    camera,
    tool,
    inventory,
    player,
    chunkManager,
    tileWorldSize: TILE_WORLD_SIZE,
  });

  const detachHud = createHud(document.body, player);
  const detachInfo = createTileInfo({
    parent: document.body,
    canvas,
    camera,
    chunkManager,
    tileWorldSize: TILE_WORLD_SIZE,
  });
  const toaster = createToaster(document.body);

  // Toolbar-managed windows. They start hidden; the toolbar opens/closes them.
  const inventoryWindow = createInventoryPanel(document.body, inventory);
  const ordersWindow = createOrdersPanel({
    parent: document.body,
    orders,
    inventory,
    player,
  });
  const shopWindow = createShopMenu({ parent: document.body, inventory, player, tool });
  const settingsWindow = createSettingsPanel({ parent: document.body });
  const debugWindow = import.meta.env.DEV
    ? createDebugPanel({ parent: document.body, player, inventory })
    : null;

  const toolbarWindows: ToolbarWindow[] = [
    { id: "inventory", label: "Inventory", window: inventoryWindow },
    { id: "trader", label: "Trader", window: ordersWindow },
    { id: "shop", label: "Shop", window: shopWindow },
    { id: "settings", label: "Settings", window: settingsWindow },
  ];
  if (debugWindow) {
    toolbarWindows.push({ id: "debug", label: "Debug", window: debugWindow });
  }

  const detachToolbar = createToolbar({
    parent: document.body,
    tool,
    windows: toolbarWindows,
  });

  // Surface level-ups to the player. Listing the new unlocks gives the
  // notification something specific to say.
  const detachLevelUp = player.subscribeLevelUp((level) => {
    const unlocks = newUnlocksAtLevel(level);
    const tail =
      unlocks.length === 0 ? "" : ` — unlocked: ${unlocks.map((u) => u.displayName).join(", ")}`;
    toaster.show(`Level ${level}!${tail}`);
  });

  const overlay = createFpsOverlay(document.body);

  gl.clearColor(0.1, 0.15, 0.2, 1.0);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);

  // Sim loop: each tick, dispatch one sim task per cached chunk that has a
  // crop or building in it. Building production events come back inside the
  // sim delta and get translated into player-inventory adds + XP here.
  let tick = 0;
  const inFlightKeys = new Set<string>();

  const runSimTick = (): void => {
    tick += 1;
    gameTimeSec += 1;
    orders.tick(gameTimeSec);

    for (const key of getSimulatableChunkKeys(chunkManager)) {
      if (inFlightKeys.has(key)) continue;
      const [cxStr, cyStr] = key.split(",");
      const chunkX = Number(cxStr);
      const chunkY = Number(cyStr);
      const record = chunkManager.peekChunk(chunkX, chunkY);
      if (!record) continue;
      inFlightKeys.add(key);
      simulationPool
        .tick(chunkX, chunkY, tick, record.data)
        .then((result) => {
          inFlightKeys.delete(key);
          if (result.delta.count > 0) {
            applySimDelta(record.data, result.delta);
            record.flags |= CHUNK_FLAG_DIRTY_RENDER | CHUNK_FLAG_DIRTY_SIMULATION;
          }
          // Apply production events to the player. Indices in the event are
          // tile-local; the building tile id is at chunk.data.tileId[i].
          for (const ev of result.delta.productionEvents) {
            inventory.add(ev.itemId as never, ev.quantity);
            player.addXp(ev.quantity * PRODUCTION_XP_PER_OUTPUT);
          }
        })
        .catch((err) => {
          inFlightKeys.delete(key);
          console.error(`sim failed for chunk ${key}`, err);
        });
    }
  };
  const simInterval = window.setInterval(runSimTick, SIM_TICK_MS);

  let savePromise: Promise<void> = Promise.resolve();
  const triggerSave = (): void => {
    savePromise = savePromise
      .then(() => saveManager.save())
      .catch((err) => console.error("autosave failed", err));
  };
  const saveInterval = window.setInterval(() => {
    if (chunkManager.dirtySimChunks().next().done) return;
    triggerSave();
  }, AUTOSAVE_MS);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") triggerSave();
  });

  const start = performance.now();
  const frame = (timestampMs: number): void => {
    if (resizeCanvasToDisplaySize(canvas)) {
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    camera.updateViewProjection(canvas.clientWidth, canvas.clientHeight);

    const rect = visibleChunkRect(
      camera.x,
      camera.y,
      canvas.clientWidth,
      canvas.clientHeight,
      camera.zoom,
      TILE_WORLD_SIZE,
      STREAM_MARGIN_CHUNKS,
    );
    chunkManager.update(rect);

    overlay.setChunkCount(renderer.chunkCount);
    overlay.setTileCount(renderer.tileCount);

    gl.clear(gl.COLOR_BUFFER_BIT);
    const t = ((timestampMs - start) / 1000) % 3600;
    renderer.draw(camera.viewProjection, t);

    overlay.tick(timestampMs);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  window.addEventListener(
    "beforeunload",
    () => {
      window.clearInterval(simInterval);
      window.clearInterval(saveInterval);
      detachControls();
      detachInteraction();
      detachHud();
      detachInfo();
      detachToolbar();
      inventoryWindow.destroy();
      ordersWindow.destroy();
      shopWindow.destroy();
      settingsWindow.destroy();
      debugWindow?.destroy();
      detachLevelUp();
      toaster.destroy();
      generationPool.terminate();
      simulationPool.terminate();
      ioClient.terminate();
    },
    { once: true },
  );
}

// Walk every cached chunk; return keys whose data contains a crop OR a
// building (both need ticking). 1024 tile slots × N chunks per second is
// cheap at MVP scale.
function getSimulatableChunkKeys(chunkManager: ChunkManager): string[] {
  const out: string[] = [];
  for (const [key, record] of chunkManager.allChunkRecords()) {
    if (chunkHasSimulatable(record)) out.push(key);
  }
  return out;
}

function chunkHasSimulatable(record: ChunkRecord): boolean {
  const ids = record.data.tileId;
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i] as number;
    // Crops 100..199 and buildings 200..299 both need ticking.
    if (id >= 100 && id <= 299) return true;
  }
  return false;
}

// Re-export tileIndex so the sim handler above can reference building tile
// ids by tile index without cross-importing into the wrong layer.
void tileIndex;

bootstrap().catch(showFatalError);
