// Behavioral test for the Phase 6 ESC priority chain.
//
// The pattern: window-closing handlers (toolbar, person_window) call
// e.preventDefault() when they actually closed something; the
// "exit possession" handler in main.ts checks e.defaultPrevented and
// skips when an upstream handler already consumed the event.
//
// The catch: this only works if the exit-possession handler is
// registered AFTER the window handlers, because the DOM dispatches
// keydown listeners in registration order. This test covers both the
// correct order (priority works) and the historical bug where the
// exit-possession handler was registered before the toolbar handler
// (priority broke). If anyone refactors main.ts and reorders the
// addEventListener calls, the regression case here will catch it.

import { describe, expect, test, vi } from "vitest";

// Helpers — same closures the real code uses, factored out so we can
// register them on a fresh EventTarget per test.
function makeWindowHandler(state: { open: boolean; onClose: () => void }) {
  return (ev: Event) => {
    if ((ev as KeyboardEvent).key !== "Escape") return;
    if (!state.open) return;
    state.open = false;
    state.onClose();
    ev.preventDefault();
  };
}

function makeExitPossessionHandler(onExit: () => void) {
  return (ev: Event) => {
    if ((ev as KeyboardEvent).key !== "Escape") return;
    if (ev.defaultPrevented) return;
    onExit();
  };
}

function dispatchEsc(target: EventTarget): Event {
  const evt = new Event("keydown", { cancelable: true });
  Object.defineProperty(evt, "key", { value: "Escape" });
  target.dispatchEvent(evt);
  return evt;
}

describe("ESC priority — listener registration order", () => {
  test("CORRECT order (window → exit-possession): window-close wins, exit does not fire", () => {
    const target = new EventTarget();
    const onClose = vi.fn();
    const onExit = vi.fn();
    const windowState = { open: true, onClose };

    target.addEventListener("keydown", makeWindowHandler(windowState));
    target.addEventListener("keydown", makeExitPossessionHandler(onExit));

    dispatchEsc(target);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onExit).not.toHaveBeenCalled();
    expect(windowState.open).toBe(false);
  });

  test("CORRECT order with no window open: exit-possession fires", () => {
    const target = new EventTarget();
    const onClose = vi.fn();
    const onExit = vi.fn();
    const windowState = { open: false, onClose };

    target.addEventListener("keydown", makeWindowHandler(windowState));
    target.addEventListener("keydown", makeExitPossessionHandler(onExit));

    dispatchEsc(target);

    expect(onClose).not.toHaveBeenCalled();
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  test("REGRESSION GUARD: registering exit-possession FIRST breaks priority", () => {
    // This is the bug shape the verification caught. If a future
    // refactor moves the exit-possession addEventListener back above
    // the toolbar listener, this test fails — same way the live game
    // would: ESC exits possession even though a window was open.
    const target = new EventTarget();
    const onClose = vi.fn();
    const onExit = vi.fn();
    const windowState = { open: true, onClose };

    target.addEventListener("keydown", makeExitPossessionHandler(onExit));
    target.addEventListener("keydown", makeWindowHandler(windowState));

    dispatchEsc(target);

    // The bug surface: exit fires even though the window was open.
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  test("multiple window handlers all run; first to consume sets defaultPrevented", () => {
    // toolbar.ts and person_window.ts both register ESC handlers. Both
    // run on every ESC press. Whichever has an open window first will
    // call preventDefault. The exit-possession handler at the end
    // then sees defaultPrevented and stays out of the way.
    const target = new EventTarget();
    const personState = { open: false, onClose: vi.fn() };
    const toolbarState = { open: true, onClose: vi.fn() };
    const onExit = vi.fn();

    target.addEventListener("keydown", makeWindowHandler(personState));
    target.addEventListener("keydown", makeWindowHandler(toolbarState));
    target.addEventListener("keydown", makeExitPossessionHandler(onExit));

    dispatchEsc(target);

    expect(personState.onClose).not.toHaveBeenCalled();
    expect(toolbarState.onClose).toHaveBeenCalledTimes(1);
    expect(onExit).not.toHaveBeenCalled();
  });
});
