// Camera input handling. Mouse wheel + click-drag on desktop; on touch
// the same single-pointer drag still pans, plus pinch gesture zooms
// around the centroid. Pointer events unify the two paths so the
// drag-pan code is identical for mouse and touch — only the wheel +
// pinch handlers branch.

import type { Camera } from "./camera";

const MIN_ZOOM = 0.005;
const MAX_ZOOM = 1.0;
const WHEEL_SENSITIVITY = 0.0015;

interface PointerSlot {
  x: number;
  y: number;
}

export function attachCameraControls(camera: Camera, target: HTMLElement): () => void {
  // Live pointer set keyed by pointerId. Lets us tell single-finger
  // drag from two-finger pinch without losing track when one finger
  // lifts mid-gesture.
  const pointers = new Map<number, PointerSlot>();
  // Last pinch distance + centroid; null when not currently pinching.
  let pinchPrevDist: number | null = null;

  const centroid = (): { x: number; y: number } | null => {
    if (pointers.size === 0) return null;
    let sx = 0;
    let sy = 0;
    for (const p of pointers.values()) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / pointers.size, y: sy / pointers.size };
  };

  const distanceBetweenTwoPointers = (): number | null => {
    if (pointers.size < 2) return null;
    const [a, b] = Array.from(pointers.values());
    if (!a || !b) return null;
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  // Zoom toward a screen-space point, preserving the world position
  // under that point. Used by both wheel and pinch so the centre of
  // the gesture stays anchored.
  const zoomTowardScreenPoint = (clientX: number, clientY: number, factor: number): void => {
    const rect = target.getBoundingClientRect();
    const sx = clientX - rect.left - rect.width / 2;
    const sy = rect.height / 2 - (clientY - rect.top);
    const worldXBefore = camera.x + sx * camera.zoom;
    const worldYBefore = camera.y + sy * camera.zoom;
    camera.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom * factor));
    const worldXAfter = camera.x + sx * camera.zoom;
    const worldYAfter = camera.y + sy * camera.zoom;
    camera.x += worldXBefore - worldXAfter;
    camera.y += worldYBefore - worldYAfter;
  };

  const onPointerDown = (e: PointerEvent): void => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    target.setPointerCapture(e.pointerId);
    camera.cancelAnimation();
    if (pointers.size === 2) {
      pinchPrevDist = distanceBetweenTwoPointers();
    } else if (pointers.size === 1) {
      camera.notifyDragInput(performance.now());
    }
  };

  const onPointerMove = (e: PointerEvent): void => {
    const slot = pointers.get(e.pointerId);
    if (!slot) return;
    const prevX = slot.x;
    const prevY = slot.y;
    slot.x = e.clientX;
    slot.y = e.clientY;

    if (pointers.size === 1) {
      // Single-pointer drag — pan. Same math as desktop mouse drag.
      const dx = e.clientX - prevX;
      const dy = e.clientY - prevY;
      camera.x -= dx * camera.zoom;
      camera.y += dy * camera.zoom;
      camera.notifyDragInput(performance.now());
    } else if (pointers.size === 2) {
      // Two-pointer pinch — scale zoom by the distance ratio,
      // anchored at the centroid so the area between the fingers
      // stays put. Pan-component (centroid translation) is folded
      // in via the zoom anchor: zoomTowardScreenPoint already
      // preserves world coords under the centroid.
      const dist = distanceBetweenTwoPointers();
      if (dist !== null && pinchPrevDist !== null && pinchPrevDist > 0) {
        const c = centroid();
        const factor = pinchPrevDist / dist;
        if (c) zoomTowardScreenPoint(c.x, c.y, factor);
      }
      pinchPrevDist = dist;
    }
  };

  const onPointerUp = (e: PointerEvent): void => {
    pointers.delete(e.pointerId);
    if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId);
    if (pointers.size < 2) pinchPrevDist = null;
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    camera.cancelAnimation();
    const factor = Math.exp(e.deltaY * WHEEL_SENSITIVITY);
    zoomTowardScreenPoint(e.clientX, e.clientY, factor);
  };

  target.addEventListener("pointerdown", onPointerDown);
  target.addEventListener("pointermove", onPointerMove);
  target.addEventListener("pointerup", onPointerUp);
  target.addEventListener("pointercancel", onPointerUp);
  target.addEventListener("wheel", onWheel, { passive: false });

  return () => {
    target.removeEventListener("pointerdown", onPointerDown);
    target.removeEventListener("pointermove", onPointerMove);
    target.removeEventListener("pointerup", onPointerUp);
    target.removeEventListener("pointercancel", onPointerUp);
    target.removeEventListener("wheel", onWheel);
  };
}
