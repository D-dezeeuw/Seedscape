// Hamburger menu — replaces the toolbar's window-button row on
// mobile. Each menu item opens the corresponding UiWindow (which is
// already mutex'd to one-at-a-time + fullscreen on touch). Guide and
// Settings stay accessible via dedicated FABs even when this menu is
// closed; they're listed here too for discoverability.
//
// CSS: `.ss-menu-fab` is hidden on desktop and shown on
// `pointer: coarse`. The list panel itself uses the standard
// `.ss-window` chrome — no special positioning required.

import { makeWindow, type UiWindow } from "./window";

interface MenuItem {
  label: string;
  open: () => void;
}

interface Deps {
  parent: HTMLElement;
  items: ReadonlyArray<MenuItem>;
}

export interface MobileMenuApi {
  destroy: () => void;
  // Show / hide the hamburger FAB. main.ts hides it during
  // possession to keep the bottom-right corner uncluttered.
  setFabVisible: (visible: boolean) => void;
}

export function createMobileMenu(deps: Deps): MobileMenuApi {
  const panel = document.createElement("div");
  panel.className = "ss-panel ss-mobile-menu";
  panel.innerHTML = `
    <h3>Menu</h3>
    <div class="ss-menu-list" data-field="list"></div>
  `;
  deps.parent.appendChild(panel);
  const list = panel.querySelector('[data-field="list"]') as HTMLDivElement;

  const window_: UiWindow = makeWindow(panel, () => {});

  // Build the menu items as buttons. Clicking an item closes the
  // menu (so it doesn't sit on top of the opened window) and opens
  // the corresponding UiWindow. The single-window mutex inside
  // makeWindow handles the close automatically when the next
  // window's show() runs, but doing it explicitly is clearer.
  for (const item of deps.items) {
    const btn = document.createElement("button");
    btn.className = "ss-btn ss-menu-item";
    btn.textContent = item.label;
    btn.addEventListener("click", () => {
      window_.hide();
      item.open();
    });
    list.appendChild(btn);
  }

  const fab = document.createElement("button");
  fab.className = "ss-btn ss-menu-fab";
  fab.setAttribute("aria-label", "Menu");
  fab.title = "Menu";
  fab.textContent = "☰";
  fab.addEventListener("click", () => window_.toggle());
  deps.parent.appendChild(fab);

  return {
    destroy: () => {
      fab.remove();
      window_.destroy();
    },
    setFabVisible: (visible) => {
      fab.style.display = visible ? "" : "none";
    },
  };
}
