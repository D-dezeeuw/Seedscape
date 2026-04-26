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

    /* Always-visible status panels. HUD top-right; performance overlay
       top-center; tile-info top-left. */
    .ss-hud { top: 8px; right: 8px; min-width: 200px; }
    .ss-performance {
      top: 8px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 10;
      pointer-events: none;
    }
    .ss-info { top: 8px; left: 8px; min-width: 220px; max-width: 280px; }

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
      border: 2px solid rgba(232, 196, 104, 0.95);
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5) inset;
      pointer-events: none;
      z-index: 4;
      will-change: transform, width, height;
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
