import { createGLContext, resizeCanvasToDisplaySize, WebGL2UnsupportedError } from "./core/canvas";
import { createFpsOverlay } from "./core/fps";
import { Camera } from "./input/camera";
import { attachCameraControls } from "./input/camera_controls";
import { type AtlasManifest, loadAtlas } from "./rendering/atlas";
import { InstancedTileRenderer } from "./rendering/instanced_tile_renderer";
import { buildInstanceBuffer, CHUNK_SIZE, createStaticChunk } from "./world/static_chunk";

// Phase 1 hardcoded world: a 16x16 grid of static chunks = 262144 tiles, which
// satisfies the 200K-tile baseline from the roadmap.
const WORLD_CHUNKS_PER_SIDE = 16;
const TILE_WORLD_SIZE = 1.0;

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

  for (let cy = 0; cy < WORLD_CHUNKS_PER_SIDE; cy++) {
    for (let cx = 0; cx < WORLD_CHUNKS_PER_SIDE; cx++) {
      const chunk = createStaticChunk(cy * WORLD_CHUNKS_PER_SIDE + cx + 1);
      const instanceData = buildInstanceBuffer(chunk, cx * CHUNK_SIZE, cy * CHUNK_SIZE);
      renderer.addChunk(instanceData);
    }
  }

  const camera = new Camera();
  // Center camera on the world midpoint.
  const worldSpan = WORLD_CHUNKS_PER_SIDE * CHUNK_SIZE * TILE_WORLD_SIZE;
  camera.x = worldSpan / 2;
  camera.y = worldSpan / 2;

  const detachControls = attachCameraControls(camera, canvas);

  const overlay = createFpsOverlay(document.body);
  overlay.setChunkCount(renderer.chunkCount);
  overlay.setTileCount(renderer.tileCount);

  gl.clearColor(0.1, 0.15, 0.2, 1.0);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);

  const start = performance.now();
  const frame = (timestampMs: number): void => {
    if (resizeCanvasToDisplaySize(canvas)) {
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    camera.updateViewProjection(canvas.width, canvas.height);

    gl.clear(gl.COLOR_BUFFER_BIT);
    const t = ((timestampMs - start) / 1000) % 3600;
    renderer.draw(camera.viewProjection, t);

    overlay.tick(timestampMs);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  window.addEventListener("beforeunload", detachControls, { once: true });
}

bootstrap().catch(showFatalError);
