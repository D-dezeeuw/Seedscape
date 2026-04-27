// Shared CSS styles. Injected once at boot so individual panels stay free of
// inline boilerplate.

const STYLE_ID = "seedscape-ui-styles";

export function injectUiStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .ss-panel {
      position: fixed;
      background: rgba(20, 26, 32, 0.92);
      color: #e8eaed;
      font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 6px;
      padding: 8px 10px;
      pointer-events: auto;
      user-select: none;
      z-index: 5;
      backdrop-filter: blur(4px);
      max-height: calc(100vh - 200px);
      overflow-y: auto;
    }
    .ss-panel h3 {
      margin: 0 0 6px 0;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #a0b3c0;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .ss-window-close {
      background: transparent;
      border: none;
      color: #708090;
      font: inherit;
      font-size: 16px;
      line-height: 1;
      padding: 0 4px;
      cursor: pointer;
      border-radius: 3px;
    }
    .ss-window-close:hover {
      color: #e8eaed;
      background: rgba(255,255,255,0.08);
    }
    .ss-subhead {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #708090;
      margin: 8px 0 4px 0;
    }

    /* Always-visible status panels. HUD + tile-info now share a
       top-left stack so the player can read both without scanning
       opposite corners. Performance overlay stays centred. */
    .ss-stack-topleft {
      position: fixed;
      top: 8px;
      left: 8px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      z-index: 5;
      pointer-events: none;
      max-height: calc(100vh - 16px);
    }
    /* Panels inside the stack flow normally instead of pinning to
       the viewport — the stack container handles positioning. The
       :where wrapper keeps the override at zero specificity so a
       future stand-alone use of these classes (without the stack)
       still picks up the .ss-panel position. */
    :where(.ss-stack-topleft) > .ss-panel {
      position: relative;
      top: auto;
      left: auto;
      right: auto;
      pointer-events: auto;
    }
    .ss-hud { min-width: 200px; }
    .ss-performance {
      position: fixed;
      top: 8px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 10;
      pointer-events: none;
    }
    .ss-info { min-width: 220px; max-width: 280px; }

    /* Toolbar-managed windows: centered above the bottom toolbar. */
    .ss-window {
      bottom: 110px;
      left: 50%;
      transform: translateX(-50%);
      min-width: 320px;
      max-width: 480px;
      max-height: calc(100vh - 160px);
    }
    /* Person window — entity-click context popover. Lives off to the
       right of the toolbar windows so both can be visible at once. */
    .ss-window.ss-person {
      bottom: 110px;
      right: 8px;
      left: auto;
      transform: none;
      min-width: 240px;
      max-width: 320px;
    }

    /* Debug window pops above its floating trigger button (bottom-right),
       not above the toolbar — debug is dev-only and lives outside the
       game UI flow. */
    .ss-window.ss-debug {
      bottom: 56px;
      right: 8px;
      left: auto;
      transform: none;
      min-width: 200px;
      max-width: 260px;
      border-color: rgba(232, 196, 104, 0.4);
    }
    .ss-window.ss-debug h3 { color: #e8c468; }
    .ss-debug-fab {
      position: fixed;
      bottom: 8px;
      right: 8px;
      z-index: 10;
      border-color: rgba(232, 196, 104, 0.4);
      color: #e8c468;
    }
    .ss-debug-fab.ss-active {
      background: #6b5520;
      border-color: #e8c468;
      color: #fff;
    }

    /* Exit-possession FAB. Bottom-left so it doesn't overlap the
       debug FAB; only visible while a possession is active. Cyan to
       match the possessed-entity ring. */
    .ss-exit-possess-fab {
      position: fixed;
      bottom: 8px;
      left: 8px;
      z-index: 10;
      border-color: rgba(116, 200, 232, 0.55);
      color: #74c8e8;
    }
    .ss-exit-possess-fab:hover {
      background: rgba(116, 200, 232, 0.16);
      color: #c8e9f7;
    }

    /* Bottom-center double toolbar. */
    .ss-toolbar-stack {
      position: fixed;
      bottom: 8px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      pointer-events: auto;
      z-index: 10;
    }
    .ss-toolbar-row {
      display: flex;
      gap: 4px;
      padding: 6px;
      background: rgba(20, 26, 32, 0.92);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 6px;
      backdrop-filter: blur(4px);
    }
    .ss-toolbar-windows .ss-btn {
      min-width: 80px;
    }

    /* Possession contextual action panel — replaces the toolbar
       while possessing. Uses the standard .ss-panel styling for
       consistency with the rest of the UI; the rules below pin it
       to the bottom-centre and tune the inner layout (button +
       optional muted hint). */
    .ss-possession-bar {
      bottom: 12px;
      left: 50%;
      transform: translateX(-50%);
      min-width: 200px;
      max-width: 320px;
      text-align: center;
      z-index: 11;
    }
    .ss-possession-action {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 14px;
      border: 1px solid rgba(255, 224, 96, 0.7);
      border-radius: 6px;
      cursor: pointer;
      box-shadow: 0 0 8px 2px rgba(255, 224, 96, 0.25);
    }
    .ss-possession-action:disabled {
      cursor: default;
      border-color: rgba(255, 255, 255, 0.12);
      box-shadow: none;
      color: rgba(232, 234, 237, 0.55);
    }
    .ss-possession-action:hover:not(:disabled) {
      border-color: rgba(255, 224, 96, 1);
      box-shadow: 0 0 10px 3px rgba(255, 224, 96, 0.45);
    }
    .ss-key-hint {
      display: inline-block;
      min-width: 16px;
      text-align: center;
      padding: 2px 6px;
      background: rgba(255, 224, 96, 0.18);
      border: 1px solid rgba(255, 224, 96, 0.5);
      border-radius: 3px;
      font-weight: 600;
    }
    .ss-possession-hint {
      padding: 6px 12px;
      border: 1px dashed rgba(255, 255, 255, 0.18);
      border-radius: 4px;
      color: rgba(232, 234, 237, 0.7);
    }

    .ss-btn {
      background: rgba(255,255,255,0.05);
      color: #e8eaed;
      border: 1px solid rgba(255,255,255,0.1);
      padding: 6px 10px;
      font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
      border-radius: 4px;
      cursor: pointer;
    }
    .ss-btn:hover { background: rgba(255,255,255,0.12); }
    .ss-btn.ss-active {
      background: #3b6f8a;
      border-color: #5b9fc0;
    }
    .ss-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .ss-btn-sell, .ss-btn-buy {
      padding: 4px 8px;
      font-size: 11px;
    }
    .ss-text-link {
      background: none;
      border: none;
      padding: 0;
      color: #e8eaed;
      font: inherit;
      cursor: pointer;
      text-align: left;
    }
    .ss-text-link:hover {
      color: #5b9fc0;
      text-decoration: underline;
    }

    /* Faced-tile reticle while possessed. Bright outline + subtle inner
       glow so the player can see exactly which tile their action will
       hit. Pointer-events off — the canvas underneath still receives
       drag and zoom; tile-action clicks are guarded separately. */
    .ss-faced-reticle {
      position: fixed;
      top: 0;
      left: 0;
      box-sizing: border-box;
      /* Default (idle / no contextual action) — thin grey so the
         player still sees their facing direction without it
         screaming "actionable". */
      border: 2px solid rgba(200, 200, 210, 0.45);
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35) inset;
      pointer-events: none;
      z-index: 4;
      will-change: transform, width, height;
      transition: border-color 80ms ease-out, box-shadow 80ms ease-out;
    }
    /* Active state — Phase 9 contextual action available. Bright
       yellow border + glow draws the eye to "press E does this". */
    .ss-faced-reticle-actionable {
      border-color: rgba(255, 224, 96, 1);
      box-shadow:
        0 0 0 1px rgba(0, 0, 0, 0.6) inset,
        0 0 8px 2px rgba(255, 224, 96, 0.55);
    }

    /* Floating name labels above entities. Positioned per-frame from
       world coords; pointer-events off so clicks pass through to the
       canvas underneath. */
    .ss-entity-labels {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 4;
    }
    .ss-entity-label {
      position: absolute;
      top: 0;
      left: 0;
      font: 11px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
      color: #f5f7fa;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85), 0 0 4px rgba(0, 0, 0, 0.6);
      padding: 1px 5px;
      white-space: nowrap;
      user-select: none;
      will-change: transform;
    }
    .ss-row {
      display: flex; justify-content: space-between; gap: 8px;
      padding: 2px 0;
    }
    .ss-row span:first-child { color: #a0b3c0; }
    .ss-empty { color: #6b7d88; font-style: italic; }
    .ss-meta { color: #6b7d88; font-size: 0.85em; margin-bottom: 4px; }
    .ss-row-actions { display: inline-flex; gap: 4px; align-items: center; }
    .ss-row-count {
      color: #e8eaed; min-width: 28px; text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .ss-btn-tight {
      padding: 1px 6px;
      font-size: 0.85em;
    }
    .ss-container-window { min-width: 280px; }
    .ss-dim { color: #6b7d88; }
    .ss-coin { color: #e8c468; }
    .ss-xpbar {
      height: 4px;
      background: rgba(255,255,255,0.08);
      border-radius: 2px;
      margin: 2px 0 4px 0;
      overflow: hidden;
    }
    .ss-xpbar-fill {
      height: 100%;
      background: #5b9fc0;
      transition: width 0.2s ease-out;
    }
    .ss-order {
      padding: 6px 4px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .ss-order:last-child { border-bottom: none; }
    .ss-order-head {
      display: flex;
      justify-content: space-between;
      color: #a0b3c0;
      font-weight: 500;
    }
    .ss-order .ss-btn-sell {
      align-self: flex-end;
      margin-top: 2px;
    }
    .ss-shop-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 3px 0;
      gap: 8px;
    }
    .ss-toast {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(91, 159, 192, 0.95);
      color: #fff;
      padding: 12px 24px;
      border-radius: 8px;
      font: 14px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
      pointer-events: none;
      z-index: 100;
      opacity: 0;
      transition: opacity 0.2s ease-out;
    }
    .ss-toast.ss-toast-visible {
      opacity: 1;
    }
    .ss-debug-row {
      display: flex; gap: 4px; margin-bottom: 4px;
    }
    .ss-debug .ss-btn {
      flex: 1;
      padding: 4px 8px;
      font-size: 11px;
    }
  `;
  document.head.appendChild(style);
}
