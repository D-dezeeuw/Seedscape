// Bottom-center double toolbar.
//   Row 1 — actions: tool buttons (none/till/plant/water/harvest/feed/dismantle).
//   Row 2 — windows: buttons that open/close the matching UiWindow.
//
// Single-window-at-a-time: opening a window auto-closes any other open one.
// ESC closes whichever window is open.
//
// Possession (Phase 9 follow-up): the entire toolbar hides while the
// player is possessing — the contextual action panel takes over the
// bottom of the screen, and god-mode windows aren't relevant while
// driving an avatar. ESC out of possession to get the toolbar back.

import { TOOL_LABELS, type Tool, type ToolState } from "../input/tool";
import type { UiWindow } from "./window";

export interface ToolbarApi {
  // Show / hide the entire toolbar. Driven by possession state in
  // main.ts — visible in god mode, hidden when driving a settler.
  setVisible(visible: boolean): void;
  // Tear down all listeners and remove the toolbar from the DOM.
  destroy(): void;
}

const TOOL_ORDER: ReadonlyArray<Tool> = [
  "none",
  "till",
  "plant",
  "water",
  "harvest",
  "feed",
  "dismantle",
];

export interface ToolbarWindow {
  id: string;
  label: string;
  window: UiWindow;
}

interface ToolbarDeps {
  parent: HTMLElement;
  tool: ToolState;
  windows: ReadonlyArray<ToolbarWindow>;
}

export function createToolbar(deps: ToolbarDeps): ToolbarApi {
  const stack = document.createElement("div");
  stack.className = "ss-toolbar-stack";

  // ---- Row 1: action tools ----
  const actionRow = document.createElement("div");
  actionRow.className = "ss-toolbar-row ss-toolbar-actions";
  const toolBtns = new Map<Tool, HTMLButtonElement>();
  for (const t of TOOL_ORDER) {
    const btn = document.createElement("button");
    btn.className = "ss-btn";
    btn.textContent = TOOL_LABELS[t];
    btn.addEventListener("click", () => deps.tool.set(t));
    actionRow.appendChild(btn);
    toolBtns.set(t, btn);
  }
  const renderTools = (snap: { current: Tool }): void => {
    for (const [t, btn] of toolBtns) {
      btn.classList.toggle("ss-active", t === snap.current);
    }
  };
  renderTools({ current: deps.tool.current });
  const unsubscribeTool = deps.tool.subscribe(renderTools);

  // ---- Row 2: window openers ----
  const windowRow = document.createElement("div");
  windowRow.className = "ss-toolbar-row ss-toolbar-windows";

  const closeAllExcept = (skip: UiWindow | null): void => {
    for (const entry of deps.windows) {
      if (entry.window !== skip && entry.window.isOpen()) entry.window.hide();
    }
  };

  const cleanups: Array<() => void> = [unsubscribeTool];
  for (const entry of deps.windows) {
    const btn = document.createElement("button");
    btn.className = "ss-btn";
    btn.textContent = entry.label;
    btn.addEventListener("click", () => {
      if (entry.window.isOpen()) {
        entry.window.hide();
      } else {
        closeAllExcept(entry.window);
        entry.window.show();
      }
    });
    windowRow.appendChild(btn);

    // Keep the button's active class in sync — a window can also close itself
    // via its own × button or via ESC.
    const off = entry.window.onChange((open) => {
      btn.classList.toggle("ss-active", open);
    });
    cleanups.push(off);
  }

  // ESC closes whichever window is open. preventDefault marks the event
  // as consumed so downstream ESC handlers (e.g. exit-possession) know
  // to step aside — the close-a-window action wins the priority chain.
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    let anyOpen = false;
    for (const entry of deps.windows) {
      if (entry.window.isOpen()) {
        anyOpen = true;
        break;
      }
    }
    if (!anyOpen) return;
    closeAllExcept(null);
    e.preventDefault();
  };
  window.addEventListener("keydown", onKey);
  cleanups.push(() => window.removeEventListener("keydown", onKey));

  stack.appendChild(windowRow);
  stack.appendChild(actionRow);
  deps.parent.appendChild(stack);

  return {
    setVisible(visible: boolean) {
      stack.style.display = visible ? "" : "none";
    },
    destroy() {
      for (const c of cleanups) c();
      stack.remove();
    },
  };
}
