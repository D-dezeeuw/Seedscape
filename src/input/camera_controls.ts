import type { Camera } from "./camera";

const MIN_ZOOM = 0.005;
const MAX_ZOOM = 1.0;
const WHEEL_SENSITIVITY = 0.0015;

export function attachCameraControls(camera: Camera, target: HTMLElement): () => void {
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  const onPointerDown = (e: PointerEvent): void => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    target.setPointerCapture(e.pointerId);
    camera.cancelAnimation();
    camera.notifyDragInput(performance.now());
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    // Pan: dragging right moves the world right relative to camera, so camera
    // moves left in world space. zoom is world-units-per-pixel so multiply.
    camera.x -= dx * camera.zoom;
    camera.y += dy * camera.zoom; // screen Y is inverted vs world Y
    camera.notifyDragInput(performance.now());
  };

  const onPointerUp = (e: PointerEvent): void => {
    dragging = false;
    if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId);
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    camera.cancelAnimation();
    // Zoom toward cursor: convert cursor screen pos to world before/after.
    const rect = target.getBoundingClientRect();
    const sx = e.clientX - rect.left - rect.width / 2;
    const sy = rect.height / 2 - (e.clientY - rect.top);
    const worldXBefore = camera.x + sx * camera.zoom;
    const worldYBefore = camera.y + sy * camera.zoom;

    const factor = Math.exp(e.deltaY * WHEEL_SENSITIVITY);
    camera.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom * factor));

    const worldXAfter = camera.x + sx * camera.zoom;
    const worldYAfter = camera.y + sy * camera.zoom;
    camera.x += worldXBefore - worldXAfter;
    camera.y += worldYBefore - worldYAfter;
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
