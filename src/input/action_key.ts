// Possess-mode action key. Pressing E (default) runs the toolbar's
// currently-selected tool against the avatar's faced tile, but only if
// that tool is in the avatar's `availableActions`. No tool selected, or
// tool not allowed for this entity class → no-op.
//
// Lives alongside InputRouter rather than inside it because this is a
// one-shot key, not a continuous state input.

import { LivingEntity } from "../state/entities/living_entity";
import type { Inventory } from "../state/inventory";
import type { Player } from "../state/player";
import type { PossessionController } from "../state/possession";
import type { ChunkManager } from "../world/chunk_manager";
import { worldTileToPick } from "./picker";
import { applyToolAt } from "./tile_interaction";
import type { ToolState } from "./tool";

const ACTION_KEYS = new Set(["e", "E"]);

interface Deps {
  possession: PossessionController;
  tool: ToolState;
  inventory: Inventory;
  player: Player;
  chunkManager: ChunkManager;
  onEdit?: (chunkX: number, chunkY: number) => void;
}

export function attachActionKey(deps: Deps): () => void {
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
    const tool = deps.tool.current;
    if (tool === "none") return;
    if (!ent.availableActions.includes(tool)) return;

    const target = ent.facedTile();
    const pick = worldTileToPick(target.x, target.y);
    applyToolAt(
      {
        tool: deps.tool,
        inventory: deps.inventory,
        player: deps.player,
        chunkManager: deps.chunkManager,
        ...(deps.onEdit ? { onEdit: deps.onEdit } : {}),
      },
      pick,
    );
  };

  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
