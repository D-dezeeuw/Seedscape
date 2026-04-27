// Reticle overlay highlighting the tile in front of the possessed avatar.
// Visible only while possessing a LivingEntity; otherwise hidden. Position
// recomputed per-frame from the entity's facedTile() and the camera
// transform (same world-to-screen math as entity_labels).
//
// Pure presentational layer — no input. Click consumption while possessed
// lives in tile_interaction so it can short-circuit before the picker runs.
//
// Two visual states (Phase 9): yellow active when the contextual action
// resolver returns an executable action for the faced tile, muted grey
// when nothing applies. The caller drives the toggle via
// `setActionable(boolean)` each frame; the reticle itself doesn't run
// the resolver.

import type { Camera } from "../input/camera";
import type { Entity } from "../state/entities/entity";
import type { PossessionController } from "../state/possession";

export class FacedTileReticle {
  private readonly el: HTMLElement;
  // Tracked so we don't toggle the className every frame — the DOM
  // does the diffing but skipping the call is still cheaper at 60Hz.
  private currentActionable = false;

  constructor(parent: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "ss-faced-reticle";
    this.el.style.display = "none";
    parent.appendChild(this.el);
  }

  // Switch between active (yellow) and muted (grey) styling. Called
  // by the per-frame loop after the resolver runs; safe to call every
  // frame since the className flip only happens on transitions.
  setActionable(actionable: boolean): void {
    if (actionable === this.currentActionable) return;
    this.currentActionable = actionable;
    this.el.classList.toggle("ss-faced-reticle-actionable", actionable);
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
