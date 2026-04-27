// Bottom-centre contextual action bar shown while the player is
// possessing a settler. Replaces the god-mode toolbar's tool row for
// the duration of possession — the toolbar's window-openers row stays
// visible so the player can still pop the Settlers panel etc.
//
// One button at a time. The button's label tracks the currently
// resolved PossessedAction (see possession_actions.ts). Pressing E
// (handled in input/action_key.ts) executes the same thing as
// clicking the button.
//
// Pure UI: doesn't run the resolver itself, doesn't dispatch the
// action. The caller passes `render(action)` each frame; the click
// handler calls back via the `onActivate` prop.

import { getItemDef } from "../state/items";
import type { PossessedAction } from "../state/possession_actions";

export interface PossessionActionBarApi {
  // Call from the per-frame loop. Cheap when nothing changed —
  // identical action shape skips a DOM rewrite.
  render(action: PossessedAction): void;
  // Show / hide the bar. Driven by possession.onChange in main.ts.
  setVisible(visible: boolean): void;
  destroy(): void;
}

export interface PossessionActionBarDeps {
  parent: HTMLElement;
  // Fires when the player clicks the button. The same code path
  // handles E-key presses; main.ts wires both to the same dispatcher.
  onActivate: () => void;
}

export function createPossessionActionBar(deps: PossessionActionBarDeps): PossessionActionBarApi {
  const bar = document.createElement("div");
  // ss-panel for the consistent panel styling (dark background,
  // rounded corners, blur, h3); ss-possession-bar pins it to the
  // bottom-centre and tunes the layout for a single-action surface.
  bar.className = "ss-panel ss-possession-bar";
  bar.style.display = "none";
  bar.innerHTML = `
    <h3>Action</h3>
    <button class="ss-btn ss-possession-action" data-act="primary">
      <span class="ss-key-hint">E</span>
      <span class="ss-action-label" data-field="label">No action</span>
    </button>
    <div class="ss-possession-hint" data-field="hint" style="display:none;"></div>
  `;
  deps.parent.appendChild(bar);

  const button = bar.querySelector('[data-act="primary"]') as HTMLButtonElement;
  const labelEl = bar.querySelector('[data-field="label"]') as HTMLElement;
  const hintEl = bar.querySelector('[data-field="hint"]') as HTMLElement;

  button.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (button.disabled) return;
    deps.onActivate();
  });

  // Track the last rendered shape so re-renders skip the DOM write
  // when nothing visible changed. Cheap diff — only the kind +
  // label string need to match for us to bail.
  let lastKey = "";

  return {
    render(action: PossessedAction) {
      const key = stringifyAction(action);
      if (key === lastKey) return;
      lastKey = key;

      const view = renderAction(action);
      if (view.kind === "active") {
        button.style.display = "";
        button.disabled = false;
        labelEl.textContent = view.label;
        hintEl.style.display = "none";
      } else if (view.kind === "blocked") {
        button.style.display = "none";
        hintEl.style.display = "";
        hintEl.textContent = view.label;
      } else {
        // none — bar is shown (we're possessing) but no action.
        button.style.display = "";
        button.disabled = true;
        labelEl.textContent = "No action";
        hintEl.style.display = "none";
      }
    },
    setVisible(visible: boolean) {
      bar.style.display = visible ? "" : "none";
      if (!visible) lastKey = ""; // force re-render on next show
    },
    destroy() {
      bar.remove();
    },
  };
}

// Map a PossessedAction to a (kind, label) view for the bar.
function renderAction(
  action: PossessedAction,
): { kind: "active"; label: string } | { kind: "blocked"; label: string } | { kind: "none" } {
  switch (action.kind) {
    case "open_container":
      return { kind: "active", label: `Open ${action.label}` };
    case "open_building":
      return { kind: "active", label: `Open ${action.label}` };
    case "haul_water":
      return { kind: "active", label: "Fill water" };
    case "harvest_crop":
      return { kind: "active", label: "Harvest" };
    case "water_crop":
      return { kind: "active", label: "Water crop" };
    case "plant_seed":
      return { kind: "active", label: `Plant ${seedName(action.seedId)}` };
    case "till":
      return { kind: "active", label: "Till" };
    case "blocked": {
      const label = action.reason === "need_water" ? "Need water" : "Need seed";
      return { kind: "blocked", label };
    }
    case "none":
      return { kind: "none" };
  }
}

// Stable string key for diffing renders. Same action shape → same
// string → no DOM write. Includes payload bits the label depends on.
function stringifyAction(action: PossessedAction): string {
  switch (action.kind) {
    case "open_container":
    case "open_building":
      return `${action.kind}:${action.label}`;
    case "haul_water":
    case "harvest_crop":
    case "water_crop":
    case "till":
      return action.kind;
    case "plant_seed":
      return `plant_seed:${action.seedId}`;
    case "blocked":
      return `blocked:${action.reason}`;
    case "none":
      return "none";
  }
}

function seedName(seedId: number): string {
  const def = getItemDef(seedId as Parameters<typeof getItemDef>[0]);
  return def?.displayName ?? "seed";
}
