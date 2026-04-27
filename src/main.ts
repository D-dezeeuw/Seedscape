import { createGLContext, resizeCanvasToDisplaySize, WebGL2UnsupportedError } from "./core/canvas";
import { createFpsOverlay } from "./core/fps";
import { attachActionKey, runContextualAction } from "./input/action_key";
import { Camera } from "./input/camera";
import { attachCameraControls } from "./input/camera_controls";
import { attachInputRouter, InputRouter } from "./input/input_router";
import { attachTileInteraction } from "./input/tile_interaction";
import { ToolState } from "./input/tool";
import { type AtlasManifest, loadAtlas } from "./rendering/atlas";
import { InstancedEntityRenderer } from "./rendering/instanced_entity_renderer";
import { InstancedTileRenderer } from "./rendering/instanced_tile_renderer";
import type { EntityServices, TileWorldAccess } from "./state/entities/entity";
import { EntityManager } from "./state/entities/entity_manager";
import { LivingEntity } from "./state/entities/living_entity";
import { spawnInitialEntities } from "./state/entities/spawn";
import { Villager } from "./state/entities/villager";
import { Inventory } from "./state/inventory";
import { asPlayerInventoryLike, asSettlerInventoryLike } from "./state/inventory_like";
import { ITEM_IDS, type ItemId } from "./state/items";
import { JobEmitter } from "./state/job_emitter";
import { JobBoard } from "./state/jobs";
import { OrderBook } from "./state/orders";
import { Player } from "./state/player";
import { entityCenter, PossessionController } from "./state/possession";
import { isActionable, resolvePossessedAction } from "./state/possession_actions";
import { SaveManager } from "./state/save_manager";
import { newUnlocksAtLevel } from "./state/unlocks";
import { BuildPreviewReticle } from "./ui/build_preview_reticle";
import { createBuildingWindow } from "./ui/building_window";
import { createContainerWindow } from "./ui/container_window";
import { createDebugPanel } from "./ui/debug_panel";
import { EntityLabels } from "./ui/entity_labels";
import { FacedTileReticle } from "./ui/faced_tile_reticle";
import { createHud } from "./ui/hud";
import { createInventoryPanel } from "./ui/inventory_panel";
import { createOrdersPanel } from "./ui/orders_panel";
import { createPersonWindow } from "./ui/person_window";
import { createPlantSeedSelector } from "./ui/plant_seed_selector";
import { createPossessionActionBar } from "./ui/possession_action_bar";
import { createSettingsPanel } from "./ui/settings_panel";
import { createSettlersWindow } from "./ui/settlers_window";
import { createShopMenu } from "./ui/shop_menu";
import { injectUiStyles } from "./ui/styles";
import { createTileInfo } from "./ui/tile_info";
import { createToaster } from "./ui/toast";
import { createToolbar, type ToolbarWindow } from "./ui/toolbar";
import { GenerationPool } from "./workers/generation_pool";
import { IoClient } from "./workers/io_client";
import { PathfindingClient } from "./workers/pathfinding_client";
import { SimulationPool } from "./workers/simulation_pool";
import {
  CHUNK_FLAG_DIRTY_RENDER,
  CHUNK_FLAG_DIRTY_SIMULATION,
  CHUNK_SIZE,
  type ChunkRecord,
  tileIndex,
} from "./world/chunk";
import { ChunkManager } from "./world/chunk_manager";
import { chunkKey, visibleChunkRect } from "./world/coords";
import { BuildingBufferStore } from "./world/farming/building_buffer";
import { autoQueueFromBuffers, buildingOutputCap } from "./world/farming/building_buffer_tick";
import { buildingForTile } from "./world/farming/building_registry";
import { CrateStore } from "./world/farming/crate";
import { restockAutoContainers } from "./world/farming/restock";
import { applySimDelta } from "./world/farming/sim_pipeline";
import { harvestTile, plantSeed, tillTile, waterTile } from "./world/farming/tile_actions";
import { buildChunkMask, isEntityWalkable } from "./world/walkability";

const TILE_WORLD_SIZE = 1.0;
const WORLD_SEED = 0xc0ffee;
const CACHE_CAPACITY = 256;
const STREAM_MARGIN_CHUNKS = 2;
const SIM_TICK_MS = 1000;
const AUTOSAVE_MS = 30_000;
const STARTING_WHEAT_SEEDS = 100;
// Player avatar walk speed in tiles/sec when possessed. Tunable; matches
// Phase 5's villager wander speed so the world's motion feels coherent
// whether or not you're driving.
const AVATAR_WALK_TILES_PER_SEC = 4;
// God-mode keyboard pan speed in tiles/sec. A bit faster than walking so
// surveying the map doesn't feel sluggish, slower than mouse drag so it
// stays controllable.
const GOD_PAN_TILES_PER_SEC = 10;
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

  const atlas = await loadAtlas(gl, `${import.meta.env.BASE_URL}atlas.png`, ATLAS_MANIFEST);
  const renderer = new InstancedTileRenderer(gl, atlas, TILE_WORLD_SIZE);
  const entityRenderer = new InstancedEntityRenderer(gl, TILE_WORLD_SIZE);
  const generationPool = new GenerationPool(WORLD_SEED);
  await generationPool.ready();
  const pathfinding = new PathfindingClient();
  // Reused scratch for mask builds — one allocation, not one per chunk-load.
  const maskScratch = new Uint8Array(1024);
  const chunkManager = new ChunkManager({
    pool: generationPool,
    renderer,
    cacheCapacity: CACHE_CAPACITY,
    hooks: {
      // pathfinding.updateChunk copies the mask into a fresh transferable
      // before posting, so the scratch buffer can be reused across calls.
      onChunkLoaded: (cx, cy, data) => {
        pathfinding.updateChunk(chunkKey(cx, cy), buildChunkMask(data, maskScratch));
      },
      onChunkEvicted: (cx, cy) => {
        pathfinding.invalidateChunk(chunkKey(cx, cy));
      },
      onChunkMutated: (cx, cy, data) => {
        pathfinding.updateChunk(chunkKey(cx, cy), buildChunkMask(data, maskScratch));
      },
    },
  });
  const simulationPool = new SimulationPool();
  const ioClient = new IoClient();
  // Reused per frame for the entity-chunk pin set passed to
  // chunkManager.update. Pooling keeps the per-frame walk allocation-
  // free in the steady state.
  const entityChunkScratch = new Set<string>();

  const camera = new Camera();
  camera.x = 0;
  camera.y = 0;

  const player = new Player();
  const inventory = new Inventory();
  inventory.add(ITEM_IDS.WHEAT_SEED, STARTING_WHEAT_SEEDS);
  const orders = new OrderBook(0);
  const entityManager = new EntityManager();
  const crates = new CrateStore();
  // Phase 8: per-building input/output buffers. Settlers feed into the
  // input side via FEED_BUILDING and haul from the output side via
  // HAUL_OUTPUT; the auto-queue pass below drains input → metadata.queued
  // so the existing sim-worker code path runs unchanged.
  const buildingBuffers = new BuildingBufferStore();
  const jobBoard = new JobBoard();
  const jobEmitter = new JobEmitter({
    board: jobBoard,
    chunks: chunkManager,
    crates,
    buildingBuffers,
  });

  // Game time: advances 1 second per sim tick. Stored separately from
  // `tick` so save/load can preserve it across sessions.
  let gameTimeSec = 0;

  const possession = new PossessionController();

  const saveManager = new SaveManager({
    io: ioClient,
    worldSeed: WORLD_SEED,
    camera,
    player,
    inventory,
    chunkManager,
    orders,
    entityManager,
    possession,
    crates,
    buildingBuffers,
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

  // Fresh launch (no save) → drop the lonely settler near origin. We
  // prime chunk(0,0) here because spawn polls peekChunk() until the
  // chunk arrives, and chunks only load through chunkManager.update —
  // which the rAF loop drives, but the rAF loop hasn't started yet.
  // Awaiting the spawn here costs ~50-200ms of boot time but eliminates
  // the visible "settlers pop in a few frames late" flicker on first
  // launch (saved games skip this path entirely via applySnapshot).
  if (!existingSave) {
    chunkManager.update({ minX: 0, maxX: 1, minY: 0, maxY: 1 });
    const spawnResult = await spawnInitialEntities({
      chunkManager,
      entityManager,
      worldSeed: WORLD_SEED,
    });
    // The starter farm patch mutates chunk(0,0)'s tile arrays — mark it
    // dirty so the GPU upload picks up the new tilled tiles AND the
    // simulation sees the mutation (relevant once the player plants).
    for (const c of spawnResult.mutatedChunks) {
      chunkManager.markDirty(
        c.chunkX,
        c.chunkY,
        CHUNK_FLAG_DIRTY_RENDER | CHUNK_FLAG_DIRTY_SIMULATION,
      );
    }
  }

  const detachControls = attachCameraControls(camera, canvas);
  const tool = new ToolState();
  const toaster = createToaster(document.body);

  const inputRouter = new InputRouter();
  const detachInputRouter = attachInputRouter(inputRouter, window);
  // Action key is attached AFTER entityServices, containerWindow, and
  // buildingWindow are constructed (Phase 9 routes E through the
  // possession action resolver, which depends on all three). Search
  // for `detachActionKey` below.

  // Camera follow + key reset on possession transitions. Subscribing
  // here instead of inline at enter() means save-load triggered enters
  // get the same wiring for free.
  const detachPossession = possession.subscribe((snap) => {
    if (snap.mode === "possess" && snap.entity) {
      const ent = snap.entity;
      const center = entityCenter(ent);
      camera.panTo(center.x, center.y);
      camera.followEntity(() => entityCenter(ent));
    } else {
      camera.unfollow();
      // Drop any keys the player was holding when possession ended —
      // otherwise W still drives the camera in god mode.
      inputRouter.clear();
    }
  });

  // Currently-selected entity id — drives the in-world selection ring.
  // Null when nothing is selected.
  let selectedEntityId: number | null = null;

  const personWindow = createPersonWindow({
    parent: document.body,
    onPossess: (entity) => {
      possession.enter(entity);
      const label = entity instanceof Villager ? entity.name : entity.type;
      toaster.show(`Possessing ${label} — press ESC to release`);
    },
    onShow: (entity) => {
      selectedEntityId = entity.id;
    },
    onHide: () => {
      selectedEntityId = null;
    },
    onPanTo: (entity) => camera.panTo(entity.worldX(), entity.worldY()),
  });

  // The container window holds a swappable InventoryLike so the same
  // panel works for both god-mode (player inventory) and possession
  // (settler carry). We start in player mode; the action key flips the
  // active side via setInventory before opening.
  const playerInventoryView = asPlayerInventoryLike(inventory);
  const containerWindow = createContainerWindow({
    parent: document.body,
    inventory: playerInventoryView,
    crates,
    readTileId: (x, y) => {
      const cx = Math.floor(x / CHUNK_SIZE);
      const cy = Math.floor(y / CHUNK_SIZE);
      const rec = chunkManager.peekChunk(cx, cy);
      if (!rec) return null;
      const lx = x - cx * CHUNK_SIZE;
      const ly = y - cy * CHUNK_SIZE;
      return rec.data.tileId[tileIndex(lx, ly)] ?? 0;
    },
    toast: (msg) => toaster.show(msg),
  });

  // Phase 8: building window for Mill / Bakery — manual deposit input,
  // withdraw output, see cycle/queue status. Containers (crate/dispenser)
  // route through containerWindow above; both callbacks fire on a
  // pan-mode click and self-check the tile type.
  const buildingWindow = createBuildingWindow({
    parent: document.body,
    inventory,
    buffers: buildingBuffers,
    readTile: (x, y) => {
      const cx = Math.floor(x / CHUNK_SIZE);
      const cy = Math.floor(y / CHUNK_SIZE);
      const rec = chunkManager.peekChunk(cx, cy);
      if (!rec) return null;
      const lx = x - cx * CHUNK_SIZE;
      const ly = y - cy * CHUNK_SIZE;
      const i = tileIndex(lx, ly);
      return {
        tileId: rec.data.tileId[i] ?? 0,
        state: rec.data.state[i] ?? 0,
        metadata: rec.data.metadata[i] ?? 0,
      };
    },
    toast: (msg) => toaster.show(msg),
  });

  const detachInteraction = attachTileInteraction({
    canvas,
    camera,
    tool,
    inventory,
    player,
    chunkManager,
    tileWorldSize: TILE_WORLD_SIZE,
    entityManager,
    onEntityClick: (entity) => personWindow.showFor(entity),
    onContainerClick: (x, y) => {
      // God-mode click → operate on the player's inventory.
      containerWindow.setInventory(playerInventoryView);
      containerWindow.showFor(x, y);
    },
    onBuildingClick: (x, y) => buildingWindow.showFor(x, y),
    isPossessing: () => possession.isPossessing(),
  });

  // Top-left stack — HUD on top, tile-info below it. Shared parent
  // so they flow vertically instead of pinning each panel to its
  // own viewport corner; see .ss-stack-topleft in styles.
  const topLeftStack = document.createElement("div");
  topLeftStack.className = "ss-stack-topleft";
  document.body.appendChild(topLeftStack);

  const detachHud = createHud(topLeftStack, player);
  const entityLabels = new EntityLabels(document.body);
  const facedReticle = new FacedTileReticle(document.body);
  const buildReticle = new BuildPreviewReticle(document.body, canvas);
  const detachInfo = createTileInfo({
    parent: topLeftStack,
    canvas,
    camera,
    chunkManager,
    tileWorldSize: TILE_WORLD_SIZE,
    entityManager,
  });

  // Toolbar-managed windows. They start hidden; the toolbar opens/closes them.
  const inventoryWindow = createInventoryPanel(document.body, inventory);
  const ordersWindow = createOrdersPanel({
    parent: document.body,
    orders,
    inventory,
    player,
  });
  const shopWindow = createShopMenu({ parent: document.body, inventory, player, tool });
  const settlersWindow = createSettlersWindow({
    parent: document.body,
    entityManager,
    onSelect: (villager) => personWindow.showFor(villager),
    onGoTo: (x, y) => camera.panTo(x, y),
  });
  const settingsWindow = createSettingsPanel({ parent: document.body });
  const debugWindow = import.meta.env.DEV
    ? createDebugPanel({
        parent: document.body,
        player,
        inventory,
        entityManager,
        camera,
        chunkManager,
        crates,
        toast: (msg) => toaster.show(msg),
      })
    : null;

  const toolbarWindows: ToolbarWindow[] = [
    { id: "inventory", label: "Inventory", window: inventoryWindow },
    { id: "trader", label: "Trader", window: ordersWindow },
    { id: "shop", label: "Shop", window: shopWindow },
    { id: "settlers", label: "Settlers", window: settlersWindow },
    { id: "settings", label: "Settings", window: settingsWindow },
  ];

  const toolbar = createToolbar({
    parent: document.body,
    tool,
    windows: toolbarWindows,
  });

  const detachPlantSelector = createPlantSeedSelector({
    parent: document.body,
    tool,
    inventory,
    player,
  });

  // Closing a toolbar window resets the tool to "Pointer" — most
  // notably, closing the Shop drops a build-tool selection so the
  // green build reticle vanishes. Other windows don't currently set
  // a tool, but the rule is uniform so future ones don't need to
  // remember to wire it.
  const toolbarWindowCloseSubs = toolbarWindows.map((entry) =>
    entry.window.onChange((open) => {
      if (!open && tool.current !== "none") tool.set("none");
    }),
  );

  // ESC priority — registered AFTER all UI keydown listeners so it runs
  // last in the DOM dispatch order. Window-closing handlers (toolbar,
  // person_window) call preventDefault when they actually close
  // something; this listener checks defaultPrevented and only exits
  // possession when nothing else consumed the event. Order matters:
  // registering this earlier breaks the priority chain because
  // defaultPrevented is read before later handlers had a chance to set
  // it. Verified by escape_priority.test.ts.
  const onEscKey = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    if (e.defaultPrevented) return;
    if (possession.isPossessing()) possession.exit();
  };
  window.addEventListener("keydown", onEscKey);

  // Exit-possession FAB. Mirrors ESC for touch users + makes the
  // current mode visually obvious. Hidden in god mode; shown while
  // possessing.
  const exitFab = document.createElement("button");
  exitFab.className = "ss-btn ss-exit-possess-fab";
  exitFab.textContent = "Exit possession";
  exitFab.style.display = "none";
  exitFab.addEventListener("click", () => {
    if (possession.isPossessing()) possession.exit();
  });
  document.body.appendChild(exitFab);
  const detachExitFabSub = possession.subscribe((snap) => {
    exitFab.style.display = snap.mode === "possess" ? "" : "none";
  });

  // Dev-only debug window has its own floating trigger button in the
  // bottom-right corner, separate from the gameplay toolbar.
  let detachDebugButton: () => void = () => {};
  if (debugWindow) {
    const fab = document.createElement("button");
    fab.className = "ss-btn ss-debug-fab";
    fab.textContent = "Debug";
    fab.addEventListener("click", () => debugWindow.toggle());
    document.body.appendChild(fab);
    const offChange = debugWindow.onChange((open) => {
      fab.classList.toggle("ss-active", open);
    });
    detachDebugButton = () => {
      offChange();
      fab.remove();
    };
  }

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
    // Phase 7: convert world state into job board entries on a fixed
    // cadence. Settlers consume from the same board on the main-thread
    // entity tick — the emitter doesn't care who's listening.
    jobEmitter.tick(tick);
    // Auto-restock dispensers from the player's inventory once per sim
    // tick. Cheap (skips early when no auto-containers loaded).
    restockAutoContainers(chunkManager, inventory, crates);
    // Phase 8: drain building input buffers into metadata.queued so the
    // sim worker keeps using the queued counter as before. Skips early
    // when no buffers have content. Runs before the chunk dispatch so a
    // newly-fed building can start its cycle this tick.
    autoQueueFromBuffers(chunkManager, buildingBuffers);

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
            const applied = applySimDelta(record.data, result.delta);
            // Only mark dirty if at least one entry actually applied —
            // a fully-skipped delta (everything raced) shouldn't churn
            // the GPU upload or autosave.
            if (applied > 0) {
              record.flags |= CHUNK_FLAG_DIRTY_RENDER | CHUNK_FLAG_DIRTY_SIMULATION;
            }
          }
          // Apply production events — but only if the tile is STILL the
          // building the sim expected. If the player dismantled or
          // replaced the building during sim flight, the cycle's output
          // is forfeit (race-loss policy consistent with applySimDelta).
          //
          // Phase 8: output goes to the building's *output buffer*, not
          // straight to player inventory. Settlers haul it via
          // HAUL_OUTPUT; the player can also withdraw manually via the
          // building window. Back-pressure: if the buffer is full, the
          // overflow is forfeit and a future tick simply produces less
          // because no input gets consumed (the cap halts cycles
          // upstream too).
          for (const ev of result.delta.productionEvents) {
            const liveTileId = record.data.tileId[ev.tileIndex] ?? 0;
            if (liveTileId !== ev.expectedTileId) continue;
            const def = buildingForTile(liveTileId);
            if (!def) continue;
            const lx = ev.tileIndex % CHUNK_SIZE;
            const ly = Math.floor(ev.tileIndex / CHUNK_SIZE);
            const wx = chunkX * CHUNK_SIZE + lx;
            const wy = chunkY * CHUNK_SIZE + ly;
            const stored = buildingBuffers.addOutput(
              wx,
              wy,
              ev.itemId as ItemId,
              ev.quantity,
              buildingOutputCap(def.outputQuantity),
            );
            // XP credits ONLY for the units that landed in the buffer —
            // overflow is back-pressured cargo, not work the player
            // benefits from.
            if (stored > 0) player.addXp(stored * PRODUCTION_XP_PER_OUTPUT);
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

  // TileWorldAccess for the settler state machine. Wraps chunkManager so
  // tile reads/writes go through the dirty-marking path (otherwise
  // walkability mirrors and renderer would not see settler-driven edits).
  const tileWorld: TileWorldAccess = {
    readTile(wx, wy) {
      const cx = Math.floor(wx / CHUNK_SIZE);
      const cy = Math.floor(wy / CHUNK_SIZE);
      const rec = chunkManager.peekChunk(cx, cy);
      if (!rec) return null;
      const lx = wx - cx * CHUNK_SIZE;
      const ly = wy - cy * CHUNK_SIZE;
      const i = tileIndex(lx, ly);
      return {
        tileId: rec.data.tileId[i] ?? 0,
        state: rec.data.state[i] ?? 0,
        metadata: rec.data.metadata[i] ?? 0,
      };
    },
    harvestAt(wx, wy) {
      const cx = Math.floor(wx / CHUNK_SIZE);
      const cy = Math.floor(wy / CHUNK_SIZE);
      const rec = chunkManager.peekChunk(cx, cy);
      if (!rec) return { applied: false };
      const lx = wx - cx * CHUNK_SIZE;
      const ly = wy - cy * CHUNK_SIZE;
      const r = harvestTile(rec.data, lx, ly);
      if (r.applied) {
        chunkManager.markDirty(cx, cy, CHUNK_FLAG_DIRTY_RENDER | CHUNK_FLAG_DIRTY_SIMULATION);
      }
      const out: { applied: boolean; produceItem?: number; yield?: number } = {
        applied: r.applied,
      };
      if (r.produceItem !== undefined) out.produceItem = r.produceItem;
      if (r.yield !== undefined) out.yield = r.yield;
      return out;
    },
    waterAt(wx, wy) {
      const cx = Math.floor(wx / CHUNK_SIZE);
      const cy = Math.floor(wy / CHUNK_SIZE);
      const rec = chunkManager.peekChunk(cx, cy);
      if (!rec) return false;
      const lx = wx - cx * CHUNK_SIZE;
      const ly = wy - cy * CHUNK_SIZE;
      const r = waterTile(rec.data, lx, ly);
      if (r.applied) {
        chunkManager.markDirty(cx, cy, CHUNK_FLAG_DIRTY_RENDER | CHUNK_FLAG_DIRTY_SIMULATION);
      }
      return r.applied;
    },
    plantSeedAt(wx, wy, seedItem) {
      const cx = Math.floor(wx / CHUNK_SIZE);
      const cy = Math.floor(wy / CHUNK_SIZE);
      const rec = chunkManager.peekChunk(cx, cy);
      if (!rec) return false;
      const lx = wx - cx * CHUNK_SIZE;
      const ly = wy - cy * CHUNK_SIZE;
      const r = plantSeed(rec.data, lx, ly, seedItem as ItemId);
      if (r.applied) {
        chunkManager.markDirty(cx, cy, CHUNK_FLAG_DIRTY_RENDER | CHUNK_FLAG_DIRTY_SIMULATION);
      }
      return r.applied;
    },
    tillAt(wx, wy) {
      const cx = Math.floor(wx / CHUNK_SIZE);
      const cy = Math.floor(wy / CHUNK_SIZE);
      const rec = chunkManager.peekChunk(cx, cy);
      if (!rec) return false;
      const lx = wx - cx * CHUNK_SIZE;
      const ly = wy - cy * CHUNK_SIZE;
      const r = tillTile(rec.data, lx, ly);
      if (r.applied) {
        chunkManager.markDirty(cx, cy, CHUNK_FLAG_DIRTY_RENDER | CHUNK_FLAG_DIRTY_SIMULATION);
      }
      return r.applied;
    },
    allChunkRecords() {
      return chunkManager.allChunkRecords();
    },
  };

  const entityServices: EntityServices = {
    jobs: jobBoard,
    pathfinding,
    crates,
    buildingBuffers,
    tileWorld,
  };

  // Phase 9: action key (E) routes through the possession action
  // resolver. Window-open results are dispatched to the existing
  // container/building windows; the container window flips to the
  // settler's inventory view via setInventory before opening.
  const actionKeyDeps = {
    possession,
    services: entityServices,
    getSimTick: () => tick,
    openContainer: (x: number, y: number, settler: Villager) => {
      containerWindow.setInventory(asSettlerInventoryLike(settler));
      containerWindow.showFor(x, y);
    },
    openBuilding: (x: number, y: number) => {
      buildingWindow.showFor(x, y);
    },
  };
  const detachActionKey = attachActionKey(actionKeyDeps);

  // Phase 9: contextual action bar — bottom-centre button shown only
  // while possessing. The button click dispatches the same code path
  // as pressing E (runContextualAction).
  const possessionBar = createPossessionActionBar({
    parent: document.body,
    onActivate: () => {
      const ent = possession.entity;
      if (ent instanceof Villager) runContextualAction(ent, actionKeyDeps);
    },
  });
  // Visibility tracks possession state. The whole toolbar hides
  // (not just the action row) — the contextual action panel takes
  // over the bottom of the screen, and god-mode window-openers
  // aren't relevant while driving an avatar.
  possession.subscribe((snap) => {
    const possessing = snap.mode === "possess";
    possessionBar.setVisible(possessing);
    toolbar.setVisible(!possessing);
  });

  // Walkability lookup used by entity AI. Returns false if the chunk
  // hasn't been generated yet — the wander code already falls back to
  // home in that case.
  const isWalkableTile = (worldTileX: number, worldTileY: number): boolean => {
    const cx = Math.floor(worldTileX / 32);
    const cy = Math.floor(worldTileY / 32);
    const lx = ((worldTileX % 32) + 32) % 32;
    const ly = ((worldTileY % 32) + 32) % 32;
    const record = chunkManager.peekChunk(cx, cy);
    if (!record) return false;
    const id = record.data.tileId[ly * 32 + lx] ?? 0;
    return isEntityWalkable(id);
  };

  const start = performance.now();
  let lastFrameMs = start;
  // Set in beforeunload so an already-queued rAF doesn't draw against
  // GL resources we just deleted (caused INVALID_OPERATION console
  // spam during reload/HMR).
  let disposed = false;
  let rafId = 0;
  const frame = (timestampMs: number): void => {
    if (disposed) return;
    if (resizeCanvasToDisplaySize(canvas)) {
      gl.viewport(0, 0, canvas.width, canvas.height);
    }

    const dt = Math.min(0.1, (timestampMs - lastFrameMs) / 1000);
    lastFrameMs = timestampMs;

    // Movement input — routes to the avatar in possess mode, to the
    // camera in god mode. Last-pressed-axis-wins is enforced upstream by
    // InputRouter so this is always strictly 4-cardinal.
    const move = inputRouter.vector();
    const possessed = possession.entity;
    if (possession.isPossessing() && possessed instanceof LivingEntity) {
      possessed.moveCardinal(move.dx, move.dy, AVATAR_WALK_TILES_PER_SEC, dt, isWalkableTile);
    } else if (move.dx !== 0 || move.dy !== 0) {
      // God-mode pan. Cancel any active panTo so keyboard input feels
      // immediate and treat the input as a "drag" so a follow we set up
      // earlier (e.g. before a save/load) pauses correctly.
      camera.cancelAnimation();
      camera.x += move.dx * GOD_PAN_TILES_PER_SEC * dt;
      camera.y += move.dy * GOD_PAN_TILES_PER_SEC * dt;
      camera.notifyDragInput(timestampMs);
    }

    camera.tickAnimation(timestampMs);
    camera.tickFollow(timestampMs);
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
    // Pin chunks that hold live entities so the LRU cache can't evict
    // them when the camera moves. Without this, off-screen settlers
    // lose their walkability mask in the pathfinding worker and freeze
    // in place — they tick fine on the main thread but every path
    // request fails. The set is rebuilt every frame because entities
    // can move between chunks; the walk is O(entities), trivial at 150.
    // Pooled to avoid per-frame allocations in the steady state.
    entityChunkScratch.clear();
    let settlerCount = 0;
    for (const e of entityManager.iterate()) {
      entityChunkScratch.add(chunkKey(e.chunkX, e.chunkY));
      if (e instanceof Villager) settlerCount++;
    }
    chunkManager.update(rect, { simKeepSet: entityChunkScratch });

    // Entity tick — main thread, every frame, with elapsed dt. Cheap at
    // MVP scale (≤16 entities). When count grows, batch into a fixed-step
    // accumulator for determinism. Skip the possessed avatar so its
    // wander AI doesn't fight player input.
    entityManager.tick(
      {
        time: gameTimeSec,
        dt,
        worldSeed: WORLD_SEED,
        isWalkable: isWalkableTile,
        simTick: tick,
        services: entityServices,
      },
      possessed?.id ?? null,
    );

    overlay.setChunkCount(renderer.chunkCount);
    overlay.setTileCount(renderer.tileCount);
    overlay.setSettlerCount(settlerCount);

    gl.clear(gl.COLOR_BUFFER_BIT);
    const t = ((timestampMs - start) / 1000) % 3600;
    renderer.draw(camera.viewProjection, t);
    entityRenderer.draw(
      entityManager.iterate(),
      camera.viewProjection,
      selectedEntityId,
      possession.entity?.id ?? null,
    );
    entityLabels.update(entityManager.iterate(), camera, canvas.clientWidth, canvas.clientHeight);
    facedReticle.update(
      possession,
      camera,
      canvas.clientWidth,
      canvas.clientHeight,
      TILE_WORLD_SIZE,
    );
    buildReticle.update(tool, camera, TILE_WORLD_SIZE);
    // Phase 9: while possessing, run the resolver against the faced
    // tile each frame. Cheap — one tile read + a few branches —
    // and drives both the reticle's actionable state (yellow vs
    // grey) and the bottom action bar's label.
    {
      const ent = possession.entity;
      if (possession.isPossessing() && ent instanceof Villager) {
        const target = ent.facedTile();
        const tile = entityServices.tileWorld?.readTile(target.x, target.y);
        const action = resolvePossessedAction(
          ent,
          tile ? { x: target.x, y: target.y, ...tile } : null,
          entityServices,
        );
        facedReticle.setActionable(isActionable(action));
        possessionBar.render(action);
      } else {
        facedReticle.setActionable(false);
      }
    }

    overlay.tick(timestampMs);
    rafId = requestAnimationFrame(frame);
  };
  rafId = requestAnimationFrame(frame);

  window.addEventListener(
    "beforeunload",
    () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      window.clearInterval(simInterval);
      window.clearInterval(saveInterval);
      window.removeEventListener("keydown", onEscKey);
      detachControls();
      detachInputRouter();
      detachActionKey();
      detachPossession();
      detachExitFabSub();
      exitFab.remove();
      detachInteraction();
      detachHud();
      detachInfo();
      topLeftStack.remove();
      for (const off of toolbarWindowCloseSubs) off();
      detachPlantSelector();
      toolbar.destroy();
      possessionBar.destroy();
      detachDebugButton();
      personWindow.destroy();
      inventoryWindow.destroy();
      ordersWindow.destroy();
      shopWindow.destroy();
      settlersWindow.destroy();
      settingsWindow.destroy();
      debugWindow?.destroy();
      detachLevelUp();
      toaster.destroy();
      entityLabels.destroy();
      facedReticle.destroy();
      buildReticle.destroy();
      entityRenderer.destroy();
      renderer.destroy();
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

bootstrap().catch(showFatalError);
