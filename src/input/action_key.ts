// Possess-mode action key (default: E). When possessing, the key
// runs the contextual action resolver against the avatar's faced tile
// and executes whichever PossessedAction came back. When NOT
// possessing, the key is a no-op — god-mode actions come from
// canvas clicks via tile_interaction.
//
// Phase 9 replaced the previous "fire the toolbar's selected tool"
// behavior. The new flow is data-driven via possession_actions.ts:
//   - resolve(faced tile, settler state) → PossessedAction
//   - execute(action) → mutate world OR return a window-open intent
// The caller wires the open intents (open_container / open_building)
// to their windows via openContainer / openBuilding callbacks.
//
// Lives alongside InputRouter rather than inside it because this is a
// one-shot key, not a continuous state input.

import type { EntityServices } from "../state/entities/entity";
import { LivingEntity } from "../state/entities/living_entity";
import { Villager } from "../state/entities/villager";
import {
  executePossessedAction,
  resolvePossessedAction,
} from "../state/possession_actions";
import type { PossessionController } from "../state/possession";

const ACTION_KEYS = new Set(["e", "E"]);

export interface ActionKeyDeps {
  possession: PossessionController;
  services: EntityServices;
  // Returns the current sim tick — used as the timestamp on memory
  // events the executor stamps. Threaded as a getter (not a number)
  // so it sees the live value at fire time, not at attach time.
  getSimTick: () => number;
  // Hooks for the two "open a window" outcomes — the executor returns
  // these without DOM access; main.ts threads the actual window APIs.
  openContainer: (worldX: number, worldY: number, settler: Villager) => void;
  openBuilding: (worldX: number, worldY: number) => void;
}

export function attachActionKey(deps: ActionKeyDeps): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (!ACTION_KEYS.has(e.key)) return;
    // Don't hijack typing in any future text inputs.
    if (e.target instanceof HTMLElement) {
      const tag = e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.target.isContentEditable) return;
    }
    if (!deps.possession.isPossessing()) return;
    const ent = deps.possession.entity;
    if (!(ent instanceof LivingEntity)) return;
    if (!(ent instanceof Villager)) return;

    runContextualAction(ent, deps);
  };

  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}

// Same dispatch the action bar's button uses on click. Exported so
// main.ts can wire both sources to identical behavior.
export function runContextualAction(villager: Villager, deps: ActionKeyDeps): void {
  const target = villager.facedTile();
  const tile = deps.services.tileWorld?.readTile(target.x, target.y);
  const action = resolvePossessedAction(
    villager,
    tile ? { x: target.x, y: target.y, ...tile } : null,
    deps.services,
  );
  const result = executePossessedAction(villager, action, deps.services, deps.getSimTick());
  if (result.kind === "open_container") {
    deps.openContainer(result.container.x, result.container.y, villager);
  } else if (result.kind === "open_building") {
    deps.openBuilding(result.building.x, result.building.y);
  }
}
