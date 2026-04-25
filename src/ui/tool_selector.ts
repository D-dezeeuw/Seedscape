// Bottom-center toolbar. Click a button to switch tool; the active tool is
// highlighted. The "build" tool is hidden from the toolbar — the shop menu
// (see shop.ts) is the entry point that pre-selects which building to place.

import { TOOL_LABELS, type Tool, type ToolState } from "../input/tool";

const TOOL_ORDER: ReadonlyArray<Tool> = [
  "none",
  "till",
  "plant",
  "water",
  "harvest",
  "feed",
  "dismantle",
];

export function createToolSelector(parent: HTMLElement, tool: ToolState): () => void {
  const panel = document.createElement("div");
  panel.className = "ss-panel ss-toolbar";

  const buttons = new Map<Tool, HTMLButtonElement>();
  for (const t of TOOL_ORDER) {
    const btn = document.createElement("button");
    btn.className = "ss-btn";
    btn.textContent = TOOL_LABELS[t];
    btn.addEventListener("click", () => tool.set(t));
    panel.appendChild(btn);
    buttons.set(t, btn);
  }
  parent.appendChild(panel);

  const render = (snapshot: { current: Tool }): void => {
    for (const [t, btn] of buttons) {
      btn.classList.toggle("ss-active", t === snapshot.current);
    }
  };
  render({ current: tool.current });
  const unsubscribe = tool.subscribe(render);

  return () => {
    unsubscribe();
    panel.remove();
  };
}
