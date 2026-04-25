// Lightweight FPS / tile-count overlay. DOM-only (no canvas allocations); the
// hot path is a single textContent write at most once per second.

export interface OverlayHandle {
  tick: (timestampMs: number) => void;
  setTileCount: (n: number) => void;
  setChunkCount: (n: number) => void;
}

export function createFpsOverlay(parent: HTMLElement): OverlayHandle {
  const el = document.createElement("div");
  el.style.cssText =
    "position:fixed;top:8px;left:8px;padding:6px 10px;background:rgba(0,0,0,0.55);" +
    "color:#e8eaed;font:12px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;" +
    "border-radius:4px;pointer-events:none;user-select:none;z-index:10;";
  el.textContent = "fps —";
  parent.appendChild(el);

  let frames = 0;
  let lastSecond = 0;
  let fps = 0;
  let tileCount = 0;
  let chunkCount = 0;

  const render = (): void => {
    el.textContent = `${fps} fps · ${chunkCount} chunks · ${tileCount.toLocaleString()} tiles`;
  };

  return {
    tick(timestampMs: number) {
      frames++;
      if (lastSecond === 0) lastSecond = timestampMs;
      const elapsed = timestampMs - lastSecond;
      if (elapsed >= 1000) {
        fps = Math.round((frames * 1000) / elapsed);
        frames = 0;
        lastSecond = timestampMs;
        render();
      }
    },
    setTileCount(n) {
      tileCount = n;
      render();
    },
    setChunkCount(n) {
      chunkCount = n;
      render();
    },
  };
}
