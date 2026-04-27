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
export function wrapPanelStructure(
  panel: HTMLElement,
  opts: { onClose?: () => void } = {},
): PanelStructure {
  const existingHeader = panel.querySelector(":scope > .ss-panel-header") as HTMLElement | null;
  const existingBody = panel.querySelector(":scope > .ss-panel-body") as HTMLElement | null;
  if (existingHeader && existingBody) {
    if (opts.onClose && !existingHeader.querySelector(".ss-panel-close")) {
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

  wrapPanelStructure(panel, { onClose: hide });

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
