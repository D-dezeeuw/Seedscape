// DOM overlay drawing a small text label above each entity. Positioned
// per-frame from world-space coords + camera transform. Labels stay at
// CSS pixel size so they're readable at any zoom (intentional — fancy
// scaling can come later when we have real character art).
//
// Pointer-events are off; the canvas keeps full input. Off-screen labels
// hide via `display: none` rather than relayout, which keeps the loop
// cheap when the camera is panned far from any entity.

import type { Camera } from "../input/camera";
import { Animal } from "../state/entities/animal";
import type { Entity } from "../state/entities/entity";
import { Villager } from "../state/entities/villager";

const VERTICAL_OFFSET_PX = 28;

export class EntityLabels {
  private readonly container: HTMLElement;
  private readonly labels = new Map<number, HTMLElement>();

  constructor(parent: HTMLElement) {
    this.container = document.createElement("div");
    this.container.className = "ss-entity-labels";
    parent.appendChild(this.container);
  }

  update(
    entities: Iterable<Entity>,
    camera: Camera,
    canvasWidth: number,
    canvasHeight: number,
  ): void {
    const seen = new Set<number>();
    for (const e of entities) {
      seen.add(e.id);
      const text = labelFor(e);
      if (text === null) continue;

      let el = this.labels.get(e.id);
      if (!el) {
        el = document.createElement("div");
        el.className = "ss-entity-label";
        this.container.appendChild(el);
        this.labels.set(e.id, el);
      }
      if (el.textContent !== text) el.textContent = text;

      // World → screen: X is direct, Y is flipped because world Y is
      // up-positive in the projection (see picker.ts for the inverse).
      const sx = canvasWidth / 2 + (e.worldX() + 0.5 - camera.x) / camera.zoom;
      const sy = canvasHeight / 2 - (e.worldY() + 0.5 - camera.y) / camera.zoom;

      // Cull off-screen with a small margin so labels at edges still
      // animate in/out smoothly.
      const margin = 50;
      if (sx < -margin || sx > canvasWidth + margin || sy < -margin || sy > canvasHeight + margin) {
        el.style.display = "none";
        continue;
      }
      el.style.display = "";
      // Anchor the label center-bottom on (sx, sy - offset).
      el.style.transform = `translate(${sx}px, ${sy - VERTICAL_OFFSET_PX}px) translate(-50%, -100%)`;
    }

    for (const [id, el] of this.labels) {
      if (!seen.has(id)) {
        el.remove();
        this.labels.delete(id);
      }
    }
  }

  destroy(): void {
    this.container.remove();
    this.labels.clear();
  }
}

function labelFor(e: Entity): string | null {
  if (e instanceof Villager) return e.name || "Settler";
  if (e instanceof Animal) return e.species || e.type;
  return null;
}
