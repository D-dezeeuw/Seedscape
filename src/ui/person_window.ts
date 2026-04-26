// Contextual entity-info popover. Opens when the player clicks an entity
// in Pan mode. Re-uses the UiWindow contract for show/hide/× close, but
// isn't part of the bottom toolbar — it's a context window that's always
// available and only visible when something's selected.
//
// The Possess button is a stub this phase. Possession control transfer
// (camera follow + WASD routing + facing-tile targeting) ships next phase.

import { Animal } from "../state/entities/animal";
import type { Entity } from "../state/entities/entity";
import { Villager } from "../state/entities/villager";
import { makeWindow } from "./window";

export interface PersonWindowApi {
  showFor: (entity: Entity) => void;
  destroy: () => void;
}

interface Deps {
  parent: HTMLElement;
  onPossess: (entity: Entity) => void;
}

export function createPersonWindow(deps: Deps): PersonWindowApi {
  const panel = document.createElement("div");
  panel.className = "ss-panel ss-person";
  panel.innerHTML = `
    <h3><span data-field="name">Person</span></h3>
    <div class="ss-row"><span>Type</span><span data-field="type"></span></div>
    <div class="ss-row"><span>At</span><span data-field="position"></span></div>
    <div class="ss-row"><span>Facing</span><span data-field="facing"></span></div>
    <div data-field="extra"></div>
    <div class="ss-debug-row" style="margin-top:8px;">
      <button class="ss-btn" data-act="possess">Possess</button>
    </div>
  `;
  deps.parent.appendChild(panel);

  const nameEl = panel.querySelector('[data-field="name"]') as HTMLElement;
  const typeEl = panel.querySelector('[data-field="type"]') as HTMLElement;
  const positionEl = panel.querySelector('[data-field="position"]') as HTMLElement;
  const facingEl = panel.querySelector('[data-field="facing"]') as HTMLElement;
  const extraEl = panel.querySelector('[data-field="extra"]') as HTMLElement;
  const possessBtn = panel.querySelector('[data-act="possess"]') as HTMLButtonElement;

  let current: Entity | null = null;
  const window_ = makeWindow(panel, () => {});

  const renderFor = (e: Entity): void => {
    current = e;
    nameEl.textContent = e instanceof Villager ? e.name : prettifyType(e);
    typeEl.textContent = e.type;
    positionEl.textContent = `${e.worldTileX()}, ${e.worldTileY()}`;
    facingEl.textContent = facingLabel(e.facing);
    if (e instanceof Animal) {
      extraEl.innerHTML = `
        <div class="ss-row"><span>Species</span><span>${e.species}</span></div>
      `;
    } else {
      extraEl.innerHTML = "";
    }
  };

  possessBtn.addEventListener("click", () => {
    if (current) deps.onPossess(current);
  });

  // ESC closes the window — independent of the toolbar's ESC handler so
  // both stay self-contained.
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape" && window_.isOpen()) window_.hide();
  };
  globalThis.window.addEventListener("keydown", onKey);

  return {
    showFor(entity: Entity) {
      renderFor(entity);
      if (!window_.isOpen()) window_.show();
    },
    destroy() {
      globalThis.window.removeEventListener("keydown", onKey);
      window_.destroy();
    },
  };
}

function facingLabel(f: number): string {
  return ["South", "West", "North", "East"][f] ?? "?";
}

function prettifyType(e: Entity): string {
  return e.type.charAt(0).toUpperCase() + e.type.slice(1);
}
