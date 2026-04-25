// Currently-selected tool. Subscribers (toolbar UI, hover preview) re-render
// on change. Phase 3 has a flat enum; later phases can grow this to hold
// per-tool config (e.g. selected seed type for the plant tool).

export type Tool = "none" | "till" | "plant" | "water" | "harvest";

export const TOOL_LABELS: Record<Tool, string> = {
  none: "Pan",
  till: "Till",
  plant: "Plant",
  water: "Water",
  harvest: "Harvest",
};

export type ToolListener = (tool: Tool) => void;

export class ToolState {
  private _current: Tool = "none";
  private readonly listeners = new Set<ToolListener>();

  get current(): Tool {
    return this._current;
  }

  set(tool: Tool): void {
    if (tool === this._current) return;
    this._current = tool;
    for (const listener of this.listeners) listener(tool);
  }

  subscribe(listener: ToolListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
