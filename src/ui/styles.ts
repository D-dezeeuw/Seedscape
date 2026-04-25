// Shared CSS styles. Injected once at boot so individual panels stay free of
// inline boilerplate. Phase 3 keeps it minimal — Phase 4+ will swap in a
// proper stylesheet if the UI grows beyond a handful of panels.

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
    }
    .ss-panel h3 {
      margin: 0 0 6px 0;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #a0b3c0;
      font-weight: 600;
    }
    .ss-hud { top: 8px; right: 8px; min-width: 160px; }
    .ss-inv { top: 80px; right: 8px; min-width: 160px; }
    .ss-info { bottom: 8px; right: 8px; min-width: 220px; }
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
    .ss-row {
      display: flex; justify-content: space-between; gap: 8px;
      padding: 2px 0;
    }
    .ss-row span:first-child { color: #a0b3c0; }
    .ss-empty { color: #6b7d88; font-style: italic; }
  `;
  document.head.appendChild(style);
}
