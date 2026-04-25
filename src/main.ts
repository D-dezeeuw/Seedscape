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
import { Player } from "./state/player";
import { SaveManager } from "./state/save_manager";
import { createHud } from "./ui/hud";
import { createInventoryPanel } from "./ui/inventory_panel";
import { injectUiStyles } from "./ui/styles";
import { createTileInfo } from "./ui/tile_info";
import { createToolSelector } from "./ui/tool_selector";
import { GenerationPool } from "./workers/generation_pool";
import { IoClient } from "./workers/io_client";
import { SimulationPool } from "./workers/simulation_pool";
import {
  CHUNK_FLAG_DIRTY_RENDER,
  CHUNK_FLAG_DIRTY_SIMULATION,
  type ChunkRecord,
} from "./world/chunk";
import { ChunkManager } from "./world/chunk_manager";
import { visibleChunkRect } from "./world/coords";
import { applySimDelta } from "./world/farming/sim_pipeline";

const TILE_WORLD_SIZE = 1.0;
const WORLD_SEED = 0xc0ffee;
const CACHE_CAPACITY = 256;
const STREAM_MARGIN_CHUNKS = 2;
// Sim cadence: 1 tick per second. Wheat (baseRate=1.0) advances one stage
// per tick → 7 seconds from seed to harvestable.
const SIM_TICK_MS = 1000;
// Auto-save cadence: every 30 seconds, plus on tab visibility change.
const AUTOSAVE_MS = 30_000;
const STARTING_WHEAT_SEEDS = 100;

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

  const saveManager = new SaveManager({
    io: ioClient,
    worldSeed: WORLD_SEED,
    camera,
    player,
    inventory,
    chunkManager,
  });

  const existingSave = await saveManager.load();
  if (existingSave) saveManager.applySnapshot(existingSave);

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
  const detachInv = createInventoryPanel(document.body, inventory);
  const detachTool = createToolSelector(document.body, tool);
  const detachInfo = createTileInfo({
    parent: document.body,
    canvas,
    camera,
    chunkManager,
    tileWorldSize: TILE_WORLD_SIZE,
  });

  const overlay = createFpsOverlay(document.body);

  gl.clearColor(0.1, 0.15, 0.2, 1.0);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);

  // Sim loop: each tick, dispatch one sim task per visible chunk that has at
  // least one crop in it. Buffers travel via Transfer; while a sim is in
  // flight the chunk's data lives in the worker — main thread must wait for
  // the result before reading or editing the chunk again. The `inFlightKeys`
  // set enforces "at most one outstanding sim per chunk" per the chunk-work
  // skill's hard rules.
  let tick = 0;
  const inFlightKeys = new Set<string>();

  const runSimTick = (): void => {
    tick += 1;
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
          // Replace the record's data with the buffers that just came back —
          // they're the same logical bytes (the worker mutates in-place is
          // not used; sim_pipeline returns a delta). But the typed-array
          // wrappers in `record.data` were detached during transfer, so we
          // swap in the fresh ones.
          record.data.tileId = result.data.tileId;
          record.data.state = result.data.state;
          record.data.metadata = result.data.metadata;
          if (result.delta.count > 0) {
            applySimDelta(record.data, result.delta);
            record.flags |= CHUNK_FLAG_DIRTY_RENDER | CHUNK_FLAG_DIRTY_SIMULATION;
          }
        })
        .catch((err) => {
          inFlightKeys.delete(key);
          console.error(`sim failed for chunk ${key}`, err);
        });
    }
  };
  const simInterval = window.setInterval(runSimTick, SIM_TICK_MS);

  // Auto-save loop. Save fires only when there's at least one dirty
  // simulation chunk so we don't spam IndexedDB on idle.
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
    camera.updateViewProjection(canvas.width, canvas.height);

    const rect = visibleChunkRect(
      camera.x,
      camera.y,
      canvas.width,
      canvas.height,
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
      detachInv();
      detachTool();
      detachInfo();
      generationPool.terminate();
      simulationPool.terminate();
      ioClient.terminate();
    },
    { once: true },
  );
}

// Inspect every cached chunk and return keys for chunks whose data contains
// at least one crop tile. Walking 1024 tile slots × N chunks once per second
// is cheap (microseconds at MVP scale).
function getSimulatableChunkKeys(chunkManager: ChunkManager): string[] {
  const out: string[] = [];
  for (const [key, record] of iterateChunkRecords(chunkManager)) {
    if (chunkHasCrop(record)) out.push(key);
  }
  return out;
}

function chunkHasCrop(record: ChunkRecord): boolean {
  const ids = record.data.tileId;
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i] as number;
    if (id >= 100 && id <= 199) return true;
  }
  return false;
}

// Tiny shim: ChunkManager doesn't expose its cache iterator publicly; we use
// dirtySimChunks which traverses every entry. This is wrong for non-dirty
// chunks though. Add a dedicated all-records iterator on the manager.
function* iterateChunkRecords(chunkManager: ChunkManager): IterableIterator<[string, ChunkRecord]> {
  yield* chunkManager.allChunkRecords();
}

bootstrap().catch(showFatalError);
