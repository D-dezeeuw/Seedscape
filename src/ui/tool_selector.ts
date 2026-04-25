// Bottom-center toolbar: pan / till / plant / water / harvest. Click a button
// to switch tool; the active tool is highlighted.

import { TOOL_LABELS, type Tool, type ToolState } from "../input/tool";

const TOOL_ORDER: ReadonlyArray<Tool> = ["none", "till", "plant", "water", "harvest"];

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

  const render = (current: Tool): void => {
    for (const [t, btn] of buttons) {
      btn.classList.toggle("ss-active", t === current);
    }
  };
  render(tool.current);
  const unsubscribe = tool.subscribe(render);

  return () => {
    unsubscribe();
    panel.remove();
  };
}
