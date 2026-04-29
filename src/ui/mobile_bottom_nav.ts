// Mobile-only (pointer: coarse) bottom nav. Replaces three previously-
// separate bottom widgets that competed for the same space on small
// screens:
//
//   - the centred `.ss-toolbar-actions` row (7 tool buttons that
//     overflowed off-screen and collided with the corner FABs)
//   - the floating ☰ hamburger FAB (bottom-right)
//   - the floating ? help FAB (bottom-left on desktop, bottom-right
//     on mobile)
//
// The bar spans 100% of the viewport width and exposes three tabs:
//
//   - Tools  → sheet listing each Tool (Pointer / Till / Plant / …).
//              Tap selects the tool and dismisses the sheet.
//   - Menu   → sheet listing each window-opener (Inventory / Trader /
//              Shop / Settlers / Settings).
//   - Guide  → opens the Game Guide window directly. No sheet — it's
//              a single destination so a sheet would be ceremony.
//
// Active-state highlights on each tab mirror its sheet's open flag so
// the player can tell which sheet is up. CSS keeps the bar hidden on
// desktop; the desktop toolbar (`.ss-toolbar-stack`) is hidden on
// mobile via the same media query so the two layouts don't fight.
//
// `setVisible(false)` toggles the bar off during possession — the
// contextual action bar + on-screen D-pad own the bottom of the
// screen there.

import { TOOL_LABELS, type Tool, type ToolState } from "../input/tool";
import { makeWindow, type UiWindow } from "./window";

const TOOL_ORDER: ReadonlyArray<Tool> = [
  "none",
  "till",
  "plant",
  "water",
  "harvest",
  "feed",
  "dismantle",
];

export interface MobileMenuItem {
  label: string;
  open: () => void;
}

export interface MobileBottomNavApi {
  setVisible: (visible: boolean) => void;
  destroy: () => void;
}

interface Deps {
  parent: HTMLElement;
  tool: ToolState;
  menuItems: ReadonlyArray<MobileMenuItem>;
  guideWindow: UiWindow;
}

export function createMobileBottomNav(deps: Deps): MobileBottomNavApi {
  // ---- Tools sheet ----------------------------------------------------
  const toolsPanel = document.createElement("div");
  toolsPanel.className = "ss-panel";
  toolsPanel.innerHTML = `
    <h3>Tools</h3>
    <div class="ss-menu-list" data-field="tools"></div>
  `;
  deps.parent.appendChild(toolsPanel);
  const toolsList = toolsPanel.querySelector('[data-field="tools"]') as HTMLDivElement;
  const toolsWindow = makeWindow(toolsPanel, () => {});

  const toolBtns = new Map<Tool, HTMLButtonElement>();
  for (const t of TOOL_ORDER) {
    const btn = document.createElement("button");
    btn.className = "ss-btn ss-menu-item";
    btn.textContent = TOOL_LABELS[t];
    btn.addEventListener("click", () => {
      deps.tool.set(t);
      toolsWindow.hide();
    });
    toolsList.appendChild(btn);
    toolBtns.set(t, btn);
  }
  const renderActiveTool = (current: Tool): void => {
    for (const [t, btn] of toolBtns) {
      btn.classList.toggle("ss-active", t === current);
    }
  };
  renderActiveTool(deps.tool.current);
  const unsubscribeTool = deps.tool.subscribe((snap) => renderActiveTool(snap.current));

  // ---- Menu sheet -----------------------------------------------------
  const menuPanel = document.createElement("div");
  menuPanel.className = "ss-panel";
  menuPanel.innerHTML = `
    <h3>Menu</h3>
    <div class="ss-menu-list" data-field="menu"></div>
  `;
  deps.parent.appendChild(menuPanel);
  const menuList = menuPanel.querySelector('[data-field="menu"]') as HTMLDivElement;
  const menuWindow = makeWindow(menuPanel, () => {});

  for (const item of deps.menuItems) {
    const btn = document.createElement("button");
    btn.className = "ss-btn ss-menu-item";
    btn.textContent = item.label;
    btn.addEventListener("click", () => {
      menuWindow.hide();
      item.open();
    });
    menuList.appendChild(btn);
  }

  // ---- Bar ------------------------------------------------------------
  const bar = document.createElement("div");
  bar.className = "ss-mobile-bottom-nav";

  const makeTab = (label: string, onTap: () => void): HTMLButtonElement => {
    const b = document.createElement("button");
    b.className = "ss-btn ss-mobile-nav-tab";
    b.textContent = label;
    b.addEventListener("click", onTap);
    bar.appendChild(b);
    return b;
  };
  const toolsTab = makeTab("Tools", () => toolsWindow.toggle());
  const menuTab = makeTab("Menu", () => menuWindow.toggle());
  const guideTab = makeTab("Guide", () => deps.guideWindow.toggle());

  const offToolsChange = toolsWindow.onChange((open) =>
    toolsTab.classList.toggle("ss-active", open),
  );
  const offMenuChange = menuWindow.onChange((open) => menuTab.classList.toggle("ss-active", open));
  const offGuideChange = deps.guideWindow.onChange((open) =>
    guideTab.classList.toggle("ss-active", open),
  );

  deps.parent.appendChild(bar);

  return {
    setVisible: (visible) => {
      bar.style.display = visible ? "" : "none";
    },
    destroy: () => {
      unsubscribeTool();
      offToolsChange();
      offMenuChange();
      offGuideChange();
      toolsWindow.destroy();
      menuWindow.destroy();
      bar.remove();
    },
  };
}
