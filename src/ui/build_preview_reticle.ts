// Reticle overlay highlighting the tile under the cursor while the
// player has the build tool armed (Shop's Build button selects a
// building, which sets tool === "build"). Mirrors `FacedTileReticle`'s
// shape but reads the mouse position instead of an avatar's faced tile.
//
// Visible only when `tool.current === "build"`; otherwise hidden. The
// border colour is green (vs the faced reticle's yellow) so the player
// can tell at a glance which interaction is armed.
//
// Pure presentational. Click handling for actually placing the
// building lives in tile_interaction.ts.

import type { Camera } from "../input/camera";
import { pickTile, worldToScreen } from "../input/picker";
import type { ToolState } from "../input/tool";

export class BuildPreviewReticle {
  private readonly el: HTMLElement;
  private lastClientX = -1;
  private lastClientY = -1;
  private readonly canvas: HTMLCanvasElement;
  private readonly onMove: (e: PointerEvent) => void;
  private readonly onLeave: () => void;

  constructor(parent: HTMLElement, canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.el = document.createElement("div");
    this.el.className = "ss-build-reticle";
    this.el.style.display = "none";
    parent.appendChild(this.el);

    this.onMove = (e: PointerEvent): void => {
      this.lastClientX = e.clientX;
      this.lastClientY = e.clientY;
    };
    this.onLeave = (): void => {
      this.lastClientX = -1;
    };
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerleave", this.onLeave);
  }

  update(tool: ToolState, camera: Camera, tileWorldSize: number): void {
    if (tool.current !== "build" || this.lastClientX < 0) {
      if (this.el.style.display !== "none") this.el.style.display = "none";
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    const px = this.lastClientX - rect.left;
    const py = this.lastClientY - rect.top;
    if (px < 0 || py < 0 || px > rect.width || py > rect.height) {
      if (this.el.style.display !== "none") this.el.style.display = "none";
      return;
    }
    const pick = pickTile(
      px,
      py,
      this.canvas.clientWidth,
      this.canvas.clientHeight,
      camera.x,
      camera.y,
      camera.zoom,
      tileWorldSize,
    );
    const { sx, sy } = worldToScreen(
      (pick.worldTileX + 0.5) * tileWorldSize,
      (pick.worldTileY + 0.5) * tileWorldSize,
      camera.x,
      camera.y,
      camera.zoom,
      this.canvas.clientWidth,
      this.canvas.clientHeight,
    );
    const sizePx = tileWorldSize / camera.zoom;

    this.el.style.display = "";
    this.el.style.transform = `translate(${sx - sizePx / 2}px, ${sy - sizePx / 2}px)`;
    this.el.style.width = `${sizePx}px`;
    this.el.style.height = `${sizePx}px`;
  }

  destroy(): void {
    this.canvas.removeEventListener("pointermove", this.onMove);
    this.canvas.removeEventListener("pointerleave", this.onLeave);
    this.el.remove();
  }
}
