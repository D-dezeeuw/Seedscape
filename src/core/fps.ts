// Lightweight performance overlay. The render loop calls tick() every frame
// and pushes the latest tile/chunk counts; the DOM only updates once per
// second (when the FPS window rolls over). FPS is averaged over the same
// 1-second window — frame-count divided by elapsed-ms × 1000.

export interface OverlayHandle {
  tick: (timestampMs: number) => void;
  setTileCount: (n: number) => void;
  setChunkCount: (n: number) => void;
}

export function createFpsOverlay(parent: HTMLElement): OverlayHandle {
  const el = document.createElement("div");
  el.className = "ss-panel ss-performance";
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
    },
    setChunkCount(n) {
      chunkCount = n;
    },
  };
}
