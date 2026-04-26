import { describe, expect, test } from "vitest";
import { InputRouter, isMovementKey } from "./input_router";

describe("isMovementKey", () => {
  test("matches WASD + arrows, both cases", () => {
    for (const k of ["w", "W", "a", "A", "s", "S", "d", "D"]) {
      expect(isMovementKey(k)).toBe(true);
    }
    for (const k of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]) {
      expect(isMovementKey(k)).toBe(true);
    }
  });

  test("ignores other keys", () => {
    for (const k of ["e", "E", " ", "Escape", "Tab", "1"]) {
      expect(isMovementKey(k)).toBe(false);
    }
  });
});

describe("InputRouter", () => {
  test("zero vector when nothing pressed", () => {
    const r = new InputRouter();
    expect(r.vector()).toEqual({ dx: 0, dy: 0 });
  });

  test("single key produces correct cardinal vector", () => {
    const r = new InputRouter();

    r.onKeyDown("w", 100);
    expect(r.vector()).toEqual({ dx: 0, dy: 1 });
    r.onKeyUp("w");

    r.onKeyDown("s", 100);
    expect(r.vector()).toEqual({ dx: 0, dy: -1 });
    r.onKeyUp("s");

    r.onKeyDown("d", 100);
    expect(r.vector()).toEqual({ dx: 1, dy: 0 });
    r.onKeyUp("d");

    r.onKeyDown("a", 100);
    expect(r.vector()).toEqual({ dx: -1, dy: 0 });
  });

  test("arrow keys behave the same as WASD", () => {
    const r = new InputRouter();
    r.onKeyDown("ArrowUp", 100);
    expect(r.vector()).toEqual({ dx: 0, dy: 1 });
    r.onKeyUp("ArrowUp");

    r.onKeyDown("ArrowRight", 100);
    expect(r.vector()).toEqual({ dx: 1, dy: 0 });
  });

  test("non-movement keys are ignored", () => {
    const r = new InputRouter();
    r.onKeyDown("e", 100);
    r.onKeyDown("Escape", 100);
    expect(r.vector()).toEqual({ dx: 0, dy: 0 });
  });

  test("two perpendicular keys: most-recent press wins (4-cardinal only)", () => {
    const r = new InputRouter();
    r.onKeyDown("w", 100);
    r.onKeyDown("d", 200);
    // d pressed later → horizontal axis wins.
    expect(r.vector()).toEqual({ dx: 1, dy: 0 });

    // Now press w again (release+press updates timestamp).
    r.onKeyUp("w");
    r.onKeyDown("w", 300);
    expect(r.vector()).toEqual({ dx: 0, dy: 1 });
  });

  test("two opposing keys on same axis: most-recent direction wins", () => {
    const r = new InputRouter();
    r.onKeyDown("a", 100);
    r.onKeyDown("d", 200);
    // d pressed later → east wins.
    expect(r.vector()).toEqual({ dx: 1, dy: 0 });

    r.onKeyDown("w", 300); // y axis now most recent
    expect(r.vector()).toEqual({ dx: 0, dy: 1 });

    r.onKeyDown("s", 400); // s most recent on y axis
    expect(r.vector()).toEqual({ dx: 0, dy: -1 });
  });

  test("auto-repeat keydown does not refresh press timestamp", () => {
    const r = new InputRouter();
    r.onKeyDown("w", 100);
    r.onKeyDown("d", 200);
    // Browser auto-repeat re-firing 'w' must NOT refresh its timestamp,
    // otherwise w would beat d every other frame and freeze movement.
    r.onKeyDown("w", 250);
    expect(r.vector()).toEqual({ dx: 1, dy: 0 });
  });

  test("clear() releases everything", () => {
    const r = new InputRouter();
    r.onKeyDown("w", 100);
    r.onKeyDown("d", 200);
    r.clear();
    expect(r.vector()).toEqual({ dx: 0, dy: 0 });
  });

  test("isHeld reflects pressed state", () => {
    const r = new InputRouter();
    expect(r.isHeld("w")).toBe(false);
    r.onKeyDown("w", 100);
    expect(r.isHeld("w")).toBe(true);
    r.onKeyUp("w");
    expect(r.isHeld("w")).toBe(false);
  });
});
