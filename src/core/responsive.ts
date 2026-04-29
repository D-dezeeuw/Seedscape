// Mobile vs desktop layout detection. Single source of truth so JS
// (toolbar collapse, D-pad mounting, panel sizing) and CSS share the
// same breakpoint.
//
// We gate on `pointer: coarse` rather than viewport width because the
// layout difference is about *input device*, not pixels: a 13" Surface
// Pro with touch should get the mobile UI; a 360px-wide browser
// window on a desktop should not. Falls back to the touch-event
// feature check when matchMedia is unavailable (very old browsers).

export function isMobileLayout(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia) {
    return window.matchMedia("(pointer: coarse)").matches;
  }
  return "ontouchstart" in window;
}

// Subscribe to layout-mode changes. Most UI is built once and styled
// via CSS media queries; subscribe is for the few systems that need
// to mount/unmount nodes (D-pad, hamburger sheet) when the user
// docks a phone or rotates an iPad.
export function onLayoutChange(cb: (mobile: boolean) => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia("(pointer: coarse)");
  const listener = (): void => cb(mq.matches);
  mq.addEventListener("change", listener);
  return () => mq.removeEventListener("change", listener);
}
