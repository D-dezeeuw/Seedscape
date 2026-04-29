// On-screen D-pad shown while possessing on touch devices.
// Replaces the WASD / arrow keys that drive movement on desktop.
// Visibility is gated by both `(pointer: coarse)` (CSS) and the
// possession state (JS via setVisible) — desktop never sees it,
// god mode on touch never sees it.
//
// The pad pushes a directional vector into an InputRouter pulse so
// the existing per-frame movement code in main.ts (which reads
// `inputRouter.vector()`) drives the avatar without branching on
// "is the player on touch or not".

import type { InputRouter } from "../input/input_router";

export interface DpadApi {
  setVisible: (visible: boolean) => void;
  destroy: () => void;
}

export function createPossessionDpad(parent: HTMLElement, router: InputRouter): DpadApi {
  const root = document.createElement("div");
  root.className = "ss-dpad";

  const buttons: Array<{ key: string; cls: string; glyph: string; dx: number; dy: number }> = [
    { key: "up", cls: "ss-dpad-btn ss-dpad-up", glyph: "↑", dx: 0, dy: -1 },
    { key: "left", cls: "ss-dpad-btn ss-dpad-left", glyph: "←", dx: -1, dy: 0 },
    { key: "right", cls: "ss-dpad-btn ss-dpad-right", glyph: "→", dx: 1, dy: 0 },
    { key: "down", cls: "ss-dpad-btn ss-dpad-down", glyph: "↓", dx: 0, dy: 1 },
  ];

  // Track which keys are currently held so the per-frame router
  // sees a stable vector across frames. Mirrors keyboard pulse:
  // pointerdown latches the axis on, pointerup latches it off.
  const held = new Map<string, boolean>();

  const updateRouter = (): void => {
    let dx = 0;
    let dy = 0;
    for (const b of buttons) {
      if (held.get(b.key)) {
        dx += b.dx;
        dy += b.dy;
      }
    }
    // Match InputRouter's last-pressed-axis-wins clamp: at most one
    // axis active. Choose the dominant — if both, keep horizontal.
    if (dx !== 0) dy = 0;
    router.setMobileVector(dx, dy);
  };

  for (const def of buttons) {
    const btn = document.createElement("button");
    btn.className = def.cls;
    btn.textContent = def.glyph;
    btn.setAttribute("aria-label", def.key);
    const onDown = (e: PointerEvent): void => {
      e.preventDefault();
      held.set(def.key, true);
      btn.setPointerCapture(e.pointerId);
      updateRouter();
    };
    const onUp = (e: PointerEvent): void => {
      held.set(def.key, false);
      if (btn.hasPointerCapture(e.pointerId)) btn.releasePointerCapture(e.pointerId);
      updateRouter();
    };
    btn.addEventListener("pointerdown", onDown);
    btn.addEventListener("pointerup", onUp);
    btn.addEventListener("pointercancel", onUp);
    btn.addEventListener("pointerleave", onUp);
    root.appendChild(btn);
  }

  parent.appendChild(root);

  return {
    setVisible: (visible) => {
      root.classList.toggle("ss-dpad-visible", visible);
      if (!visible) {
        held.clear();
        router.setMobileVector(0, 0);
      }
    },
    destroy: () => {
      router.setMobileVector(0, 0);
      root.remove();
    },
  };
}
