// Reticle overlay highlighting the tile in front of the possessed avatar.
// Visible only while possessing a LivingEntity; otherwise hidden. Position
// recomputed per-frame from the entity's facedTile() and the camera
// transform (same world-to-screen math as entity_labels).
//
// Pure presentational layer — no input. Click consumption while possessed
// lives in tile_interaction so it can short-circuit before the picker runs.

import type { Camera } from "../input/camera";
import type { Entity } from "../state/entities/entity";
import type { PossessionController } from "../state/possession";

export class FacedTileReticle {
  private readonly el: HTMLElement;

  constructor(parent: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "ss-faced-reticle";
    this.el.style.display = "none";
    parent.appendChild(this.el);
  }

  update(
    possession: PossessionController,
    camera: Camera,
    canvasWidth: number,
    canvasHeight: number,
    tileWorldSize: number,
  ): void {
    const ent: Entity | null = possession.entity;
    if (!possession.isPossessing() || !ent) {
      if (this.el.style.display !== "none") this.el.style.display = "none";
      return;
    }

    const target = ent.facedTile();
    // World→screen for the tile's center. World Y is up-positive in the
    // projection so screen Y is flipped (matches entity_labels).
    const cx = (target.x + 0.5) * tileWorldSize;
    const cy = (target.y + 0.5) * tileWorldSize;
    const sx = canvasWidth / 2 + (cx - camera.x) / camera.zoom;
    const sy = canvasHeight / 2 - (cy - camera.y) / camera.zoom;
    const sizePx = tileWorldSize / camera.zoom;

    this.el.style.display = "";
    // Anchor at center; subtract half-size to get the top-left.
    this.el.style.transform = `translate(${sx - sizePx / 2}px, ${sy - sizePx / 2}px)`;
    this.el.style.width = `${sizePx}px`;
    this.el.style.height = `${sizePx}px`;
  }

  destroy(): void {
    this.el.remove();
  }
}
