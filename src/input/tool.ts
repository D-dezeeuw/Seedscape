// Currently-selected tool plus per-tool config. Phase 3 had a flat enum;
// Phase 4 introduces "build" (which needs to know which building to place)
// and "feed" (clicks a placed building to enqueue a job from inventory).

export type Tool = "none" | "till" | "plant" | "water" | "harvest" | "build" | "feed" | "dismantle";

export const TOOL_LABELS: Record<Tool, string> = {
  none: "Pan",
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
}

export type ToolListener = (snapshot: ToolSnapshot) => void;

export class ToolState {
  private _current: Tool = "none";
  private _selectedBuildingId: number | null = null;
  private readonly listeners = new Set<ToolListener>();

  get current(): Tool {
    return this._current;
  }

  get selectedBuildingId(): number | null {
    return this._selectedBuildingId;
  }

  set(tool: Tool): void {
    if (tool === this._current) return;
    this._current = tool;
    // Drop the building selection when leaving build mode so re-entering
    // build doesn't accidentally place the previous pick.
    if (tool !== "build") this._selectedBuildingId = null;
    this.fire();
  }

  // Convenience: arm the build tool with a specific building. Used by the
  // shop UI's Build button.
  selectBuilding(buildingId: number): void {
    this._current = "build";
    this._selectedBuildingId = buildingId;
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
    };
    for (const listener of this.listeners) listener(snap);
  }
}
