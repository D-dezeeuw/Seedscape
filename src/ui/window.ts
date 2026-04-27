// Common UiWindow contract for toolbar-managed panels. Each panel constructs
// its element, then wraps it via `makeWindow` to expose show/hide/toggle and
// an open-state subscription the toolbar uses to keep its button highlighted.
//
// Windows start hidden — the toolbar opens them on demand.
//
// Every panel — windows and always-on status panels alike — gets its inner
// structure normalized via `wrapPanelStructure`: the first <h3> becomes the
// title inside a sticky `.ss-panel-header`, an optional close button sits
// to its right, and everything else is moved into a scrollable
// `.ss-panel-body`. This means no panel needs to manually wire scrolling
// or close-button DOM — the helper handles both.

export interface UiWindow {
  readonly element: HTMLElement;
  destroy: () => void;
  show: () => void;
  hide: () => void;
  toggle: () => void;
  isOpen: () => boolean;
  onChange: (cb: (open: boolean) => void) => () => void;
}

export interface PanelStructure {
  headerEl: HTMLElement;
  bodyEl: HTMLElement;
}

// Reorganizes a panel into header + body. Idempotent: a second call is a
// no-op so callers (`makeWindow`, plus any panel that pre-wraps itself)
// can't double-wrap.
//
// `headerExtras` are inserted between the title and the close button, in
// the order given. The person window uses this to mount an eye icon
// next to its close (×) for a one-shot camera pan to the entity.
export function wrapPanelStructure(
  panel: HTMLElement,
  opts: { onClose?: () => void; headerExtras?: HTMLElement[] } = {},
): PanelStructure {
  const existingHeader = panel.querySelector(":scope > .ss-panel-header") as HTMLElement | null;
  const existingBody = panel.querySelector(":scope > .ss-panel-body") as HTMLElement | null;
  if (existingHeader && existingBody) {
    const closeEl = existingHeader.querySelector(".ss-panel-close") as HTMLElement | null;
    if (opts.headerExtras) {
      for (const el of opts.headerExtras) {
        if (closeEl) existingHeader.insertBefore(el, closeEl);
        else existingHeader.appendChild(el);
      }
    }
    if (opts.onClose && !closeEl) {
      existingHeader.appendChild(buildCloseButton(opts.onClose));
    }
    return { headerEl: existingHeader, bodyEl: existingBody };
  }

  const h3 = panel.querySelector(":scope > h3") as HTMLElement | null;
  if (!h3) {
    throw new Error("wrapPanelStructure: panel must contain a top-level <h3>");
  }

  const header = document.createElement("div");
  header.className = "ss-panel-header";
  panel.insertBefore(header, h3);
  header.appendChild(h3);

  if (opts.headerExtras) {
    for (const el of opts.headerExtras) header.appendChild(el);
  }
  if (opts.onClose) {
    header.appendChild(buildCloseButton(opts.onClose));
  }

  const body = document.createElement("div");
  body.className = "ss-panel-body";
  while (header.nextSibling) {
    body.appendChild(header.nextSibling);
  }
  panel.appendChild(body);

  return { headerEl: header, bodyEl: body };
}

function buildCloseButton(onClose: () => void): HTMLButtonElement {
  const close = document.createElement("button");
  close.className = "ss-panel-close";
  close.textContent = "×";
  close.setAttribute("aria-label", "Close");
  close.addEventListener("click", (e) => {
    e.stopPropagation();
    onClose();
  });
  return close;
}

// Global registry of every UiWindow currently mounted. Used to enforce
// "only one window open at a time" — opening any window via show()
// closes whichever sibling was already open. Without this, callers
// outside the toolbar (entity-click → person, tile-click → container /
// building) could leave their panel up while the user opened a toolbar
// window, producing overlapping panels.
const REGISTRY: Set<UiWindow> = new Set();

export function makeWindow(
  panel: HTMLElement,
  onDestroy: () => void,
  opts: { headerExtras?: HTMLElement[] } = {},
): UiWindow {
  panel.classList.add("ss-window");
  panel.style.display = "none";

  let open = false;
  const listeners = new Set<(open: boolean) => void>();
  const fire = (next: boolean): void => {
    for (const cb of listeners) cb(next);
  };

  // Forward declaration so show() can pass `self` to closeOthers without
  // a circular const-binding error.
  let self: UiWindow;

  const show = (): void => {
    if (open) return;
    for (const other of REGISTRY) {
      if (other !== self && other.isOpen()) other.hide();
    }
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

  wrapPanelStructure(panel, {
    onClose: hide,
    ...(opts.headerExtras ? { headerExtras: opts.headerExtras } : {}),
  });

  self = {
    element: panel,
    destroy: () => {
      REGISTRY.delete(self);
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
  REGISTRY.add(self);
  return self;
}
