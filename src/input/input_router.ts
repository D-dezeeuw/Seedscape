// Movement input router. Owns WASD + arrow keys; tracks press timestamps
// so the dominant axis is "most-recently-pressed wins" — pressing W and D
// at the same time produces a 4-cardinal vector aligned to whichever was
// pressed last, never a diagonal.
//
// Convention: world +Y is up on screen, world +X is right. Pressing W or
// ArrowUp produces dy = +1; pressing D or ArrowRight produces dx = +1.
// Camera (god mode) and avatar (possess mode) both map directly to these.
//
// The router itself is a pure logic class — `attach()` wires it to a
// Window, but the class is testable without the DOM by feeding events
// through onKeyDown/onKeyUp directly.

export type Axis = -1 | 0 | 1;

export interface InputVector {
  dx: Axis;
  dy: Axis;
}

const ZERO: InputVector = { dx: 0, dy: 0 };

const KEY_NORTH = new Set(["w", "W", "ArrowUp"]);
const KEY_SOUTH = new Set(["s", "S", "ArrowDown"]);
const KEY_EAST = new Set(["d", "D", "ArrowRight"]);
const KEY_WEST = new Set(["a", "A", "ArrowLeft"]);

const ALL_KEYS = new Set([...KEY_NORTH, ...KEY_SOUTH, ...KEY_EAST, ...KEY_WEST]);

export function isMovementKey(key: string): boolean {
  return ALL_KEYS.has(key);
}

export class InputRouter {
  // Map of currently-held movement keys → press timestamp. Auto-repeat
  // events are ignored (we only record the first press until release).
  private readonly pressed = new Map<string, number>();
  // Mobile D-pad shadow vector. Touch UI doesn't fire keyboard
  // events, so the D-pad pushes a vector here directly. Folded into
  // vector() so the per-frame consumer doesn't have to branch.
  private mobileDx: Axis = 0;
  private mobileDy: Axis = 0;

  setMobileVector(dx: number, dy: number): void {
    this.mobileDx = (dx > 0 ? 1 : dx < 0 ? -1 : 0) as Axis;
    this.mobileDy = (dy > 0 ? 1 : dy < 0 ? -1 : 0) as Axis;
  }

  onKeyDown(key: string, timeMs: number): void {
    if (!isMovementKey(key)) return;
    if (this.pressed.has(key)) return; // browser auto-repeat
    this.pressed.set(key, timeMs);
  }

  onKeyUp(key: string): void {
    this.pressed.delete(key);
  }

  // Release everything — call when window loses focus or possession is
  // exited mid-press, so a stale "W is held" doesn't drift the camera.
  clear(): void {
    this.pressed.clear();
  }

  isHeld(key: string): boolean {
    return this.pressed.has(key);
  }

  // Returns the current 4-cardinal input vector. If both axes have keys
  // pressed, the axis whose most-recent press is later wins. The
  // mobile D-pad's vector takes priority when keyboard input is
  // empty — mixing keyboard + touch in the same frame is degenerate
  // (only one input source is active in practice) so the precedence
  // rule keeps the resolved vector deterministic.
  vector(): InputVector {
    const east = this.maxPressTime(KEY_EAST);
    const west = this.maxPressTime(KEY_WEST);
    const north = this.maxPressTime(KEY_NORTH);
    const south = this.maxPressTime(KEY_SOUTH);

    const horiz = Math.max(east, west);
    const vert = Math.max(north, south);

    if (horiz === 0 && vert === 0) {
      if (this.mobileDx !== 0 || this.mobileDy !== 0) {
        // World Y is up-positive but the D-pad emits screen-style
        // (down = +1) — flip here so an "up" tap maps to dy = +1
        // like the W key. The dpad component already produces
        // screen-style; this keeps the InputRouter contract.
        const dy = -this.mobileDy as Axis;
        if (this.mobileDx !== 0) return { dx: this.mobileDx, dy: 0 };
        return { dx: 0, dy };
      }
      return ZERO;
    }
    if (horiz > vert) {
      return { dx: east > west ? 1 : -1, dy: 0 };
    }
    return { dx: 0, dy: north > south ? 1 : -1 };
  }

  private maxPressTime(keys: Set<string>): number {
    let m = 0;
    for (const k of keys) {
      const t = this.pressed.get(k);
      if (t !== undefined && t > m) m = t;
    }
    return m;
  }
}

// Wires a router to global key events. Skips events that originate inside
// editable elements so future text inputs don't double-act as movement.
export function attachInputRouter(router: InputRouter, win: Window): () => void {
  const isEditableTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    return target.isContentEditable;
  };

  const onDown = (e: KeyboardEvent): void => {
    if (isEditableTarget(e.target)) return;
    if (!isMovementKey(e.key)) return;
    // Stop arrow keys from scrolling the page.
    e.preventDefault();
    router.onKeyDown(e.key, performance.now());
  };

  const onUp = (e: KeyboardEvent): void => {
    if (!isMovementKey(e.key)) return;
    router.onKeyUp(e.key);
  };

  // Forget held keys when the window blurs — otherwise tabbing away while
  // walking leaves the avatar drifting forever.
  const onBlur = (): void => router.clear();

  win.addEventListener("keydown", onDown);
  win.addEventListener("keyup", onUp);
  win.addEventListener("blur", onBlur);
  return () => {
    win.removeEventListener("keydown", onDown);
    win.removeEventListener("keyup", onUp);
    win.removeEventListener("blur", onBlur);
    router.clear();
  };
}
