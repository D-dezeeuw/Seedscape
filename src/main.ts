import { createGLContext, resizeCanvasToDisplaySize, WebGL2UnsupportedError } from "./core/canvas";
import { createFpsOverlay } from "./core/fps";
import { Camera } from "./input/camera";
import { attachCameraControls } from "./input/camera_controls";
import { type AtlasManifest, loadAtlas } from "./rendering/atlas";
import { InstancedTileRenderer } from "./rendering/instanced_tile_renderer";
import { GenerationPool } from "./workers/generation_pool";
import { ChunkManager } from "./world/chunk_manager";
import { visibleChunkRect } from "./world/coords";

const TILE_WORLD_SIZE = 1.0;
const WORLD_SEED = 0xc0ffee;
// Cache enough chunks to keep recently-visited area resident. Per
// docs/06_memory_performance.md MAX_CACHED_CHUNKS=512 is the long-term target;
// 256 is a comfortable Phase 2 starting point (~5MB CPU + ~4MB GPU at peak).
const CACHE_CAPACITY = 256;
// Generation lead: keep this many chunks of margin outside the camera frustum
// so chunks finish generating before they scroll into view.
const STREAM_MARGIN_CHUNKS = 2;

// Atlas manifest is locked in data/tiles.json. Mirrored here so the renderer
// boots without a JSON fetch on first frame; if these drift, the loader's
// dimension check fails fast.
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

  const atlas = await loadAtlas(gl, "/atlas.png", ATLAS_MANIFEST);
  const renderer = new InstancedTileRenderer(gl, atlas, TILE_WORLD_SIZE);
  const pool = new GenerationPool(WORLD_SEED);
  await pool.ready();
  const chunkManager = new ChunkManager({ pool, renderer, cacheCapacity: CACHE_CAPACITY });

  const camera = new Camera();
  // Bloomridge starter origin: open the world centered on chunk (0,0).
  camera.x = 0;
  camera.y = 0;

  const detachControls = attachCameraControls(camera, canvas);

  const overlay = createFpsOverlay(document.body);

  gl.clearColor(0.1, 0.15, 0.2, 1.0);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);

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
      detachControls();
      pool.terminate();
    },
    { once: true },
  );
}

bootstrap().catch(showFatalError);
