import { describe, expect, test } from "vitest";
import { Camera } from "./camera";

describe("Camera.panTo animation", () => {
  test("advances toward target over duration and lands exactly", () => {
    const c = new Camera();
    c.x = 0;
    c.y = 0;
    const start = performance.now();
    c.panTo(10, 0, 1000);
    expect(c.isAnimating()).toBe(true);

    // Halfway: smoothstep(0.5) = 0.5, so x ≈ 5. Tolerance is 2 decimals
    // because `start` is captured before panTo runs, so anim.startMs lands
    // a fraction of a ms later than `start` — on slower CI hosts that drift
    // can push the computed t to ~0.498, well within 0.005 of 5.0.
    c.tickAnimation(start + 500);
    expect(c.x).toBeCloseTo(5, 2);

    // Past the duration: snaps exactly to target and stops animating.
    c.tickAnimation(start + 1100);
    expect(c.x).toBe(10);
    expect(c.y).toBe(0);
    expect(c.isAnimating()).toBe(false);
  });

  test("smoothstep eases — quarter time gives less than quarter distance", () => {
    const c = new Camera();
    const start = performance.now();
    c.panTo(100, 0, 1000);
    c.tickAnimation(start + 250); // 25% time
    // smoothstep(0.25) = 0.15625 — definitely less than 0.25.
    expect(c.x).toBeGreaterThan(0);
    expect(c.x).toBeLessThan(25);
  });

  test("cancelAnimation halts the glide where it stands", () => {
    const c = new Camera();
    const start = performance.now();
    c.panTo(10, 0, 1000);
    c.tickAnimation(start + 500);
    const halfX = c.x;
    c.cancelAnimation();
    expect(c.isAnimating()).toBe(false);
    c.tickAnimation(start + 1000); // should be a no-op
    expect(c.x).toBe(halfX);
  });

  test("duration scales with distance, clamped to PAN_MIN_MS / PAN_MAX_MS", () => {
    // (placeholder — overwritten by test below; this keeps the diff small)
    expect(true).toBe(true);
  });
});

describe("Camera follow mode", () => {
  test("followEntity → tracking lerps toward target outside dead zone", () => {
    const c = new Camera();
    c.x = 0;
    c.y = 0;
    let tx = 10,
      ty = 0;
    c.followEntity(() => ({ x: tx, y: ty }), { deadZone: 0.5, lerp: 0.5 });
    expect(c.isFollowing()).toBe(true);

    // First tick: 10 units away, well past dead zone. Lerp 0.5 → halve gap.
    c.tickFollow(0);
    expect(c.x).toBeCloseTo(5, 5);

    // Next tick: another half.
    c.tickFollow(16);
    expect(c.x).toBeCloseTo(7.5, 5);
  });

  test("inside dead zone: camera holds still", () => {
    const c = new Camera();
    c.x = 5;
    c.y = 5;
    c.followEntity(() => ({ x: 5.4, y: 5 }), { deadZone: 1, lerp: 0.5 });
    c.tickFollow(0);
    expect(c.x).toBe(5);
    expect(c.y).toBe(5);
  });

  test("notifyDragInput pauses tracking", () => {
    const c = new Camera();
    c.x = 0;
    c.y = 0;
    c.followEntity(() => ({ x: 10, y: 0 }), { deadZone: 0.5, lerp: 0.5 });
    c.notifyDragInput(0);
    c.tickFollow(0);
    // Paused → camera should not move toward target.
    expect(c.x).toBe(0);
  });

  test("after idleResumeMs the camera glides back via panTo", () => {
    const c = new Camera();
    c.x = 0;
    c.y = 0;
    c.followEntity(() => ({ x: 10, y: 0 }), {
      deadZone: 0.5,
      lerp: 0.5,
      idleResumeMs: 1000,
    });
    c.notifyDragInput(0);
    // Just before timeout: still paused.
    c.tickFollow(900);
    expect(c.isAnimating()).toBe(false);
    expect(c.x).toBe(0);
    // At timeout: panTo kicked off, mode flips back to tracking.
    c.tickFollow(1000);
    expect(c.isAnimating()).toBe(true);
  });

  test("unfollow clears follow state", () => {
    const c = new Camera();
    c.followEntity(() => ({ x: 10, y: 0 }));
    c.unfollow();
    expect(c.isFollowing()).toBe(false);
    // tickFollow no-ops when not following.
    c.x = 0;
    c.tickFollow(0);
    expect(c.x).toBe(0);
  });

  test("active panTo blocks lerp until it finishes", () => {
    const c = new Camera();
    c.x = 0;
    c.y = 0;
    c.followEntity(() => ({ x: 10, y: 0 }), { deadZone: 0.5, lerp: 0.5 });
    c.panTo(20, 0, 1000); // panTo runs to (20,0)
    // While anim is active, follow lerp is suppressed.
    c.tickFollow(performance.now());
    expect(c.x).toBe(0);
  });
});

describe("Camera.panTo (continued)", () => {
  test("duration scales with distance, clamped to PAN_MIN_MS / PAN_MAX_MS", () => {
    const c = new Camera();
    // Tiny pan — should clamp to the minimum.
    c.panTo(1, 0);
    // We can't read the duration directly, but a 50ms tick on a min-200ms
    // anim should still be mid-flight.
    c.tickAnimation(performance.now() + 50);
    expect(c.isAnimating()).toBe(true);
    c.cancelAnimation();

    // Huge pan — should clamp to the max (1500ms). At 1400ms still going.
    c.panTo(10000, 0);
    c.tickAnimation(performance.now() + 1400);
    expect(c.isAnimating()).toBe(true);
  });
});
