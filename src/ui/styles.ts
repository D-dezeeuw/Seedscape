// Shared CSS styles. Injected once at boot so individual panels stay free of
// inline boilerplate. Phase 3 kept it minimal; Phase 4 grows it for the new
// orders / shop / building panels.

const STYLE_ID = "seedscape-ui-styles";

export function injectUiStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .ss-panel {
      position: fixed;
      background: rgba(20, 26, 32, 0.85);
      color: #e8eaed;
      font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 6px;
      padding: 8px 10px;
      pointer-events: auto;
      user-select: none;
      z-index: 5;
      backdrop-filter: blur(4px);
      max-height: calc(100vh - 100px);
      overflow-y: auto;
    }
    .ss-panel h3 {
      margin: 0 0 6px 0;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #a0b3c0;
      font-weight: 600;
    }
    .ss-subhead {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #708090;
      margin: 8px 0 4px 0;
    }
    .ss-hud { top: 8px; right: 8px; min-width: 200px; }
    .ss-inv { top: 200px; right: 8px; min-width: 200px; }
    .ss-info { bottom: 60px; right: 8px; min-width: 220px; }
    .ss-orders { top: 8px; left: 8px; min-width: 240px; max-width: 280px; }
    .ss-shop { top: 8px; left: 270px; min-width: 220px; }
    .ss-toolbar {
      bottom: 8px; left: 50%; transform: translateX(-50%);
      display: flex; gap: 4px; padding: 6px;
    }
    .ss-btn {
      background: rgba(255,255,255,0.05);
      color: #e8eaed;
      border: 1px solid rgba(255,255,255,0.1);
      padding: 6px 10px;
      font: inherit;
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
    .ss-debug {
      bottom: 80px; left: 8px; min-width: 180px;
      border-color: rgba(232, 196, 104, 0.4);
    }
    .ss-debug h3 { color: #e8c468; }
    .ss-debug-toggle {
      cursor: pointer;
      user-select: none;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .ss-debug-toggle:hover {
      color: #f5d680;
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
