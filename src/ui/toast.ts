// Lightweight transient message — used for level-up notifications. Single
// element, queued messages replace the visible one.

export function createToaster(parent: HTMLElement): {
  show: (message: string, durationMs?: number) => void;
  destroy: () => void;
} {
  const el = document.createElement("div");
  el.className = "ss-toast";
  parent.appendChild(el);

  let hideTimer: number | null = null;

  const show = (message: string, durationMs = 3000): void => {
    el.textContent = message;
    el.classList.add("ss-toast-visible");
    if (hideTimer !== null) window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      el.classList.remove("ss-toast-visible");
      hideTimer = null;
    }, durationMs);
  };

  const destroy = (): void => {
    if (hideTimer !== null) window.clearTimeout(hideTimer);
    el.remove();
  };

  return { show, destroy };
}
