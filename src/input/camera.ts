import { type Mat4, mat4Ortho } from "../core/math";

// 2D orthographic camera. Position is the world-space point shown at screen
// center; zoom is "world units per screen pixel" (smaller = more zoomed in).
//
// Animated pans: panTo(x, y) sets up a smoothstep-eased glide from the
// current position to the target. Drag/wheel input cancels the glide.

const PAN_TILES_PER_SEC = 30;
const PAN_MIN_MS = 200;
const PAN_MAX_MS = 1500;

// Follow defaults. Dead-zone is the radius around the camera center the
// follow target can move within without the camera reacting; outside it
// the camera lerps toward the target. Idle-resume is how long after the
// last drag input we wait before gliding the camera back to the target.
const FOLLOW_DEAD_ZONE_TILES = 1.5;
const FOLLOW_LERP_FACTOR = 0.12;
const FOLLOW_IDLE_RESUME_MS = 1500;

interface PanAnimation {
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  startMs: number;
  durationMs: number;
}

export type FollowTarget = () => { x: number; y: number };

interface FollowState {
  target: FollowTarget;
  deadZone: number;
  lerp: number;
  // When 'paused', the per-frame lerp is skipped and the camera doesn't
  // pull on the target. notifyDragInput sets this; the idle timeout
  // promotes back to 'tracking' via a panTo glide.
  mode: "tracking" | "paused";
  lastDragMs: number | null;
  idleResumeMs: number;
}

export class Camera {
  x = 0;
  y = 0;
  zoom = 0.05; // world units per pixel
  readonly viewProjection: Mat4 = new Float32Array(16);
  private anim: PanAnimation | null = null;
  private follow: FollowState | null = null;

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

  // Begin tracking a moving target each frame. The camera keeps the
  // target inside `deadZone` tiles of its center; outside it, the camera
  // lerps toward the target by `lerp` per frame. Drag input pauses the
  // tracking; after idleResumeMs the camera glides back via panTo.
  followEntity(
    target: FollowTarget,
    options?: {
      deadZone?: number;
      lerp?: number;
      idleResumeMs?: number;
    },
  ): void {
    this.follow = {
      target,
      deadZone: options?.deadZone ?? FOLLOW_DEAD_ZONE_TILES,
      lerp: options?.lerp ?? FOLLOW_LERP_FACTOR,
      mode: "tracking",
      lastDragMs: null,
      idleResumeMs: options?.idleResumeMs ?? FOLLOW_IDLE_RESUME_MS,
    };
  }

  unfollow(): void {
    this.follow = null;
  }

  isFollowing(): boolean {
    return this.follow !== null;
  }

  // Camera_controls calls this on drag input so the follow logic knows to
  // pause and reset its idle timer. No-op when not following.
  notifyDragInput(nowMs: number): void {
    if (!this.follow) return;
    this.follow.mode = "paused";
    this.follow.lastDragMs = nowMs;
  }

  // Per-frame follow update. Run after tickAnimation so any active panTo
  // glide (including the idle-resume glide we kick off here) drives the
  // camera while it's running, and the lerp picks up once it finishes.
  tickFollow(nowMs: number): void {
    const f = this.follow;
    if (!f) return;
    if (f.mode === "paused") {
      // Idle long enough? Schedule a glide back to the target and switch
      // back to tracking — the panTo hands off to lerp once it finishes.
      if (f.lastDragMs !== null && nowMs - f.lastDragMs >= f.idleResumeMs) {
        const t = f.target();
        this.panTo(t.x, t.y);
        f.mode = "tracking";
        f.lastDragMs = null;
      }
      return;
    }
    // panTo is running (incl. resume glide) — let it finish.
    if (this.anim) return;
    const t = f.target();
    const dx = t.x - this.x;
    const dy = t.y - this.y;
    if (Math.hypot(dx, dy) > f.deadZone) {
      this.x += dx * f.lerp;
      this.y += dy * f.lerp;
    }
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
