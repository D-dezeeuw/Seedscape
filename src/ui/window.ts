// Common UiWindow contract for toolbar-managed panels. Each panel constructs
// its element, then wraps it via `makeWindow` to expose show/hide/toggle and
// an open-state subscription the toolbar uses to keep its button highlighted.
//
// Windows start hidden — the toolbar opens them on demand.

export interface UiWindow {
  readonly element: HTMLElement;
  destroy: () => void;
  show: () => void;
  hide: () => void;
  toggle: () => void;
  isOpen: () => boolean;
  onChange: (cb: (open: boolean) => void) => () => void;
}

export function makeWindow(panel: HTMLElement, onDestroy: () => void): UiWindow {
  panel.classList.add("ss-window");
  panel.style.display = "none";

  let open = false;
  const listeners = new Set<(open: boolean) => void>();
  const fire = (next: boolean): void => {
    for (const cb of listeners) cb(next);
  };

  const show = (): void => {
    if (open) return;
    panel.style.display = "";
    open = true;
    fire(true);
  };
  const hide = (): void => {
    if (!open) return;
    panel.style.display = "none";
    open = false;
    fire(false);
  };
  const toggle = (): void => {
    if (open) hide();
    else show();
  };

  // Inject a close (×) button into the first <h3> header if present. Wires to
  // hide() so toolbar listeners get the change notification.
  const header = panel.querySelector("h3");
  if (header) {
    const close = document.createElement("button");
    close.className = "ss-window-close";
    close.textContent = "×";
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      hide();
    });
    header.appendChild(close);
  }

  return {
    element: panel,
    destroy: () => {
      panel.remove();
      onDestroy();
    },
    show,
    hide,
    toggle,
    isOpen: () => open,
    onChange: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
