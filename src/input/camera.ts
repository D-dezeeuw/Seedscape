import { type Mat4, mat4Ortho } from "../core/math";

// 2D orthographic camera. Position is the world-space point shown at screen
// center; zoom is "world units per screen pixel" (smaller = more zoomed in).
//
// Animated pans: panTo(x, y) sets up a smoothstep-eased glide from the
// current position to the target. Drag/wheel input cancels the glide.

const PAN_TILES_PER_SEC = 30;
const PAN_MIN_MS = 200;
const PAN_MAX_MS = 1500;

interface PanAnimation {
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  startMs: number;
  durationMs: number;
}

export class Camera {
  x = 0;
  y = 0;
  zoom = 0.05; // world units per pixel
  readonly viewProjection: Mat4 = new Float32Array(16);
  private anim: PanAnimation | null = null;

  // Easing: smoothstep — slow start, fast middle, slow finish.
  // (The "ease in → out → in" feel for a follow-cam.)
  private static smoothstep(t: number): number {
    const c = Math.max(0, Math.min(1, t));
    return c * c * (3 - 2 * c);
  }

  panTo(targetX: number, targetY: number, durationMs?: number): void {
    const dist = Math.hypot(targetX - this.x, targetY - this.y);
    const computed = (dist / PAN_TILES_PER_SEC) * 1000;
    const dur = durationMs ?? Math.max(PAN_MIN_MS, Math.min(PAN_MAX_MS, computed));
    this.anim = {
      startX: this.x,
      startY: this.y,
      targetX,
      targetY,
      startMs: performance.now(),
      durationMs: dur,
    };
  }

  // Called from the rAF loop. No-op when nothing is animating.
  tickAnimation(nowMs: number): void {
    if (!this.anim) return;
    const tRaw = (nowMs - this.anim.startMs) / this.anim.durationMs;
    if (tRaw >= 1) {
      this.x = this.anim.targetX;
      this.y = this.anim.targetY;
      this.anim = null;
      return;
    }
    const e = Camera.smoothstep(tRaw);
    this.x = this.anim.startX + (this.anim.targetX - this.anim.startX) * e;
    this.y = this.anim.startY + (this.anim.targetY - this.anim.startY) * e;
  }

  cancelAnimation(): void {
    this.anim = null;
  }

  isAnimating(): boolean {
    return this.anim !== null;
  }

  updateViewProjection(viewportWidth: number, viewportHeight: number): void {
    const halfW = (viewportWidth * this.zoom) / 2;
    const halfH = (viewportHeight * this.zoom) / 2;
    mat4Ortho(
      this.viewProjection,
      this.x - halfW,
      this.x + halfW,
      this.y - halfH,
      this.y + halfH,
      -1,
      1,
    );
  }
}
