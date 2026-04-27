// Currently-selected tool plus per-tool config. Phase 3 had a flat enum;
// Phase 4 introduced "build" (needs to know which building to place);
// the plant tool gained a selected-seed slot once the player got more
// than one seed kind in inventory and a deterministic pick became
// necessary.

import type { ItemId } from "../state/items";

export type Tool = "none" | "till" | "plant" | "water" | "harvest" | "build" | "feed" | "dismantle";

export const TOOL_LABELS: Record<Tool, string> = {
  none: "Pointer",
  till: "Till",
  plant: "Plant",
  water: "Water",
  harvest: "Harvest",
  feed: "Feed",
  build: "Build",
  dismantle: "Dismantle",
};

export interface ToolSnapshot {
  current: Tool;
  // For "build": the building tile id the user picked from the shop. Null
  // when no building is selected (the build tool is meaningless without it).
  selectedBuildingId: number | null;
  // For "plant": the seed item id the player picked from the seed
  // selector. Null falls back to a priority-list pick in tile_interaction.
  selectedSeedId: ItemId | null;
}

export type ToolListener = (snapshot: ToolSnapshot) => void;

export class ToolState {
  private _current: Tool = "none";
  private _selectedBuildingId: number | null = null;
  private _selectedSeedId: ItemId | null = null;
  private readonly listeners = new Set<ToolListener>();

  get current(): Tool {
    return this._current;
  }

  get selectedBuildingId(): number | null {
    return this._selectedBuildingId;
  }

  get selectedSeedId(): ItemId | null {
    return this._selectedSeedId;
  }

  set(tool: Tool): void {
    if (tool === this._current) return;
    this._current = tool;
    // Drop the per-tool selection when leaving the corresponding mode so
    // re-entering doesn't accidentally apply the previous pick.
    if (tool !== "build") this._selectedBuildingId = null;
    if (tool !== "plant") this._selectedSeedId = null;
    this.fire();
  }

  // Convenience: arm the build tool with a specific building. Used by the
  // shop UI's Build button.
  selectBuilding(buildingId: number): void {
    this._current = "build";
    this._selectedBuildingId = buildingId;
    this.fire();
  }

  // Set the seed used by the plant tool. Caller should ensure the seed is
  // unlocked + carried; the picker in tile_interaction defends against
  // staleness anyway. Pass null to clear the selection.
  selectSeed(seedId: ItemId | null): void {
    if (this._selectedSeedId === seedId) return;
    this._selectedSeedId = seedId;
    this.fire();
  }

  subscribe(listener: ToolListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private fire(): void {
    const snap: ToolSnapshot = {
      current: this._current,
      selectedBuildingId: this._selectedBuildingId,
      selectedSeedId: this._selectedSeedId,
    };
    for (const listener of this.listeners) listener(snap);
  }
}
