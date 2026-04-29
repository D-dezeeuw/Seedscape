// Shared CSS styles. Injected once at boot so individual panels stay free of
// inline boilerplate.

const STYLE_ID = "seedscape-ui-styles";

export function injectUiStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    /* Every panel is a flex column: a sticky .ss-panel-header on top
       and a scrolling .ss-panel-body below. The panel itself owns
       the chrome (background, border, blur) and clips the corners;
       header/body own their own padding so the scroll-bar lives
       inside the rounded edge. */
    .ss-panel {
      position: fixed;
      background: rgba(20, 26, 32, 0.92);
      color: #e8eaed;
      font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 6px;
      padding: 0;
      pointer-events: auto;
      user-select: none;
      z-index: 5;
      backdrop-filter: blur(4px);
      max-height: calc(100vh - 16px);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .ss-panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 6px 10px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      flex: 0 0 auto;
    }
    .ss-panel-header h3 {
      margin: 0;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #a0b3c0;
      font-weight: 600;
    }
    .ss-panel-body {
      padding: 8px 10px;
      overflow-y: auto;
      flex: 1 1 auto;
      min-height: 0;
    }
    .ss-panel-close, .ss-panel-eye {
      background: transparent;
      border: none;
      color: #708090;
      font: inherit;
      line-height: 1;
      cursor: pointer;
      border-radius: 3px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .ss-panel-close { font-size: 16px; padding: 0 4px; }
    .ss-panel-eye { padding: 2px 4px; }
    .ss-panel-close:hover, .ss-panel-eye:hover {
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
    /* Person window — entity-click context popover. Pinned to the
       right of the toolbar so the layout remains predictable; only
       one panel is open at a time (window mutex in window.ts). */
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

    /* Help FAB. Same bottom-left slot as the exit-possession FAB but
       only one is visible at a time (god mode shows help; possession
       shows exit). Round, single-glyph "?" for instant recognition. */
    .ss-help-fab {
      position: fixed;
      bottom: 8px;
      left: 8px;
      z-index: 10;
      width: 32px;
      height: 32px;
      padding: 0;
      border-radius: 50%;
      font-size: 16px;
      font-weight: 600;
      line-height: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    /* Game Guide — long-form, multi-chapter doc. Wider than the
       default toolbar window so the sidebar + content pane both fit
       without crowding. The body itself scrolls (panel chrome already
       sets overflow on .ss-panel-body) so chapters of any length are
       safe. */
    .ss-window.ss-guide {
      min-width: 560px;
      max-width: 720px;
    }
    .ss-guide-layout {
      display: flex;
      gap: 12px;
      align-items: stretch;
      min-height: 320px;
    }
    .ss-guide-toc {
      flex: 0 0 160px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      border-right: 1px solid rgba(255,255,255,0.06);
      padding-right: 8px;
    }
    .ss-guide-toc-item {
      background: transparent;
      border: 1px solid transparent;
      color: #c8d0d8;
      font: inherit;
      text-align: left;
      padding: 4px 8px;
      border-radius: 0.5rem;
      cursor: pointer;
    }
    .ss-guide-toc-item:hover {
      background: rgba(255,255,255,0.06);
      color: #e8eaed;
    }
    .ss-guide-toc-item.ss-active {
      background: #3b6f8a;
      border-color: #5b9fc0;
      color: #fff;
    }
    .ss-guide-content {
      flex: 1 1 auto;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .ss-guide-title {
      margin: 0 0 8px 0;
      font-size: 14px;
      color: #e8eaed;
      font-weight: 600;
    }
    .ss-guide-content p { margin: 0 0 8px 0; line-height: 1.5; }
    .ss-guide-content ul { margin: 0 0 8px 0; padding-left: 18px; }
    .ss-guide-content li { margin-bottom: 3px; line-height: 1.5; }
    .ss-guide-content b { color: #e8c468; font-weight: 600; }
    .ss-guide-nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-top: auto;
      padding-top: 12px;
      border-top: 1px solid rgba(255,255,255,0.06);
    }
    .ss-guide-counter {
      color: #708090;
      font-variant-numeric: tabular-nums;
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

    /* Plant-tool seed selector — floats just above the toolbar
       while the plant tool is active. Mirrors the toolbar's row
       styling (dark backdrop + blur) so it visually belongs to
       the toolbar group. */
    .ss-plant-selector {
      position: fixed;
      bottom: 92px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: 4px;
      padding: 6px;
      background: rgba(20, 26, 32, 0.92);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 6px;
      backdrop-filter: blur(4px);
      z-index: 10;
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
      background: rgba(0, 0, 0, 0.5);
      color: #e8eaed;
      border: 1px solid rgba(255,255,255,0.1);
      padding: 8px 14px;
      font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
      border-radius: 0.5rem;
      cursor: pointer;
    }
    .ss-btn:hover { background: rgba(0, 0, 0, 0.7); }
    .ss-btn.ss-active {
      background: #3b6f8a;
      border-color: #5b9fc0;
    }
    .ss-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .ss-input {
      background: rgba(0, 0, 0, 0.5);
      color: #e8eaed;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 0.5rem;
      padding: 6px 8px;
      font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
      width: 12ch;
      outline: none;
    }
    .ss-input:focus { border-color: #5b9fc0; }
    .ss-input::placeholder { color: #708090; }
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

    /* Build-tool preview reticle — same shape as the possession
       reticle but green (vs yellow) so the player can tell at a
       glance which interaction is armed. Visible whenever the
       build tool is active and the cursor is over the canvas. */
    .ss-build-reticle {
      position: fixed;
      top: 0;
      left: 0;
      box-sizing: border-box;
      border: 2px solid rgba(120, 220, 120, 0.95);
      box-shadow:
        0 0 0 1px rgba(0, 0, 0, 0.6) inset,
        0 0 8px 2px rgba(120, 220, 120, 0.45);
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
    /* Need bars in the Person window. Same shape as the XP bar — a
       thin horizontal track + filled bar — but tinted by value so a
       hungry settler reads at a glance. */
    .ss-need-bar {
      height: 4px;
      background: rgba(255,255,255,0.08);
      border-radius: 2px;
      margin: 2px 0 6px 0;
      overflow: hidden;
    }
    .ss-need-bar-fill {
      height: 100%;
      transition: width 0.2s ease-out, background-color 0.2s ease-out;
    }
    .ss-need-bar-fill.ss-need-high { background: #6abf6a; }
    .ss-need-bar-fill.ss-need-mid  { background: #d4a046; }
    .ss-need-bar-fill.ss-need-low  { background: #c45a5a; }
    .ss-need-value { font-variant-numeric: tabular-nums; }

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
      padding: 3px 6px;
      gap: 8px;
      border-radius: 0.4rem;
      transition: background-color 80ms ease-out;
    }
    /* Armed-build highlight: the shop row whose Build button armed
       the build tool stays lit until the tool resets (closing the
       Shop, picking another tool, or arming a different building). */
    .ss-shop-row.ss-active {
      background: rgba(120, 220, 120, 0.18);
      box-shadow: inset 0 0 0 1px rgba(120, 220, 120, 0.5);
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

    /* ---------------- Mobile layout (pointer: coarse) ----------------
       Phones / tablets / touch laptops. Gated on input class, not
       viewport width — a 13" touch Surface should get the mobile UI;
       a 360px-wide desktop window should not. Common pattern for
       game UIs.

       Highlights:
       - Toolbar windows go fullscreen (one panel at a time, easy to
         dismiss via the existing × in the panel header).
       - The desktop bottom toolbar + corner FABs are replaced by a
         single full-width bottom nav (.ss-mobile-bottom-nav) — see
         the dedicated section further down.
       - Tap targets bumped to ≥44px square per Apple HIG / Material.
       - Safe-area insets respected so iPhone home indicator + Android
         nav bar don't hide controls.
       - Browser zoom disabled (viewport meta); the canvas owns
         pinch + drag via pointer events. */
    @media (pointer: coarse) {
      /* Every toolbar/contextual window fills the viewport. Anchor to
         all four edges via inset:0 so the element stretches to fill
         the viewport. The previous rule set inset:0 and then reset
         all four offsets to auto with width/height: 100vw/100vh —
         which leaves position:fixed with no anchor and falls back
         to static-flow position. On iOS Safari that resolves below
         the 100vh canvas (top: 100vh), so the panel rendered off-
         screen and looked "not open". */
      .ss-window {
        inset: 0;
        width: auto;
        height: auto;
        max-width: none;
        min-width: 0;
        max-height: none;
        border-radius: 0;
        transform: none;
        padding-top: env(safe-area-inset-top);
        padding-bottom: env(safe-area-inset-bottom);
      }

      /* Larger tap targets — buttons are core-loop interactions. */
      .ss-btn {
        min-height: 40px;
        padding: 10px 16px;
        font-size: 13px;
      }
      .ss-btn-tight {
        min-height: 32px;
        padding: 4px 10px;
        font-size: 12px;
      }

      /* Desktop toolbar (action row + window-opener row) is fully
         replaced by .ss-mobile-bottom-nav on mobile. Hide the whole
         stack so the two layouts don't overlap. */
      .ss-toolbar-stack { display: none; }

      /* Floating ?, ☰ FABs are folded into the bottom nav's Guide /
         Menu tabs. Hide them on mobile so they don't double up. */
      .ss-help-fab,
      .ss-menu-fab { display: none; }

      /* Plant seed selector floats above the bottom nav. The bar is
         ~52–86px tall depending on safe-area; 92px clears it. */
      .ss-plant-selector {
        bottom: calc(92px + env(safe-area-inset-bottom));
      }

      /* Top-left stack stays at the corner but respects the notch. */
      .ss-stack-topleft {
        top: calc(8px + env(safe-area-inset-top));
        left: calc(8px + env(safe-area-inset-left));
        max-width: calc(100vw - 16px - env(safe-area-inset-left) - env(safe-area-inset-right));
      }
      .ss-hud, .ss-info { min-width: 0; max-width: 100%; }

      /* Performance HUD: keep visible but smaller. */
      .ss-performance {
        top: calc(8px + env(safe-area-inset-top));
        font-size: 11px;
        padding: 4px 8px;
      }

      /* Exit-possession FAB — bottom-left, only visible while
         possessing (when the bottom nav is hidden). */
      .ss-exit-possess-fab {
        bottom: calc(8px + env(safe-area-inset-bottom));
        left: calc(8px + env(safe-area-inset-left));
      }

      /* Dev-only debug FAB sits above the bottom nav's right edge so
         it doesn't get covered by the bar in god mode. */
      .ss-debug-fab {
        bottom: calc(96px + env(safe-area-inset-bottom));
        right: calc(8px + env(safe-area-inset-right));
      }

      /* Possession action bar: bigger button so it doubles as the
         E-key replacement on touch. */
      .ss-possession-action {
        padding: 14px 24px;
        font-size: 14px;
      }
    }

    /* ---------------- Mobile bottom nav (pointer: coarse) ----------
       Full-width bar pinned to the bottom on touch devices. Owns
       three tabs: Tools (sheet), Menu (sheet), Guide (window). See
       mobile_bottom_nav.ts for the wiring. Hidden on desktop and
       toggled off during possession (the contextual action bar +
       on-screen D-pad take over the bottom of the screen). */
    .ss-mobile-bottom-nav { display: none; }
    @media (pointer: coarse) {
      .ss-mobile-bottom-nav {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        display: flex;
        gap: 4px;
        padding: 6px env(safe-area-inset-right)
                calc(6px + env(safe-area-inset-bottom))
                env(safe-area-inset-left);
        background: rgba(20, 26, 32, 0.92);
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        backdrop-filter: blur(4px);
        z-index: 10;
      }
      .ss-mobile-nav-tab {
        flex: 1 1 0;
        min-width: 0;
      }
    }

    .ss-menu-list { display: flex; flex-direction: column; gap: 6px; }
    .ss-menu-item {
      width: 100%;
      text-align: left;
      padding: 14px 16px;
      font-size: 15px;
      min-height: 48px;
    }

    /* ---------------- Possession D-pad (mobile) ----------------
       Visible only when (a) on a touch device and (b) the player is
       possessing a settler. main.ts toggles a class on the dpad
       container based on the possession subscription. */
    .ss-dpad {
      position: fixed;
      bottom: calc(72px + env(safe-area-inset-bottom));
      left: calc(12px + env(safe-area-inset-left));
      display: none;
      grid-template-columns: 48px 48px 48px;
      grid-template-rows: 48px 48px 48px;
      gap: 4px;
      z-index: 10;
      pointer-events: none;
    }
    @media (pointer: coarse) {
      .ss-dpad.ss-dpad-visible { display: grid; }
    }
    .ss-dpad-btn {
      pointer-events: auto;
      background: rgba(0, 0, 0, 0.6);
      color: #e8eaed;
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 0.5rem;
      font-size: 20px;
      line-height: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      user-select: none;
      -webkit-user-select: none;
      -webkit-tap-highlight-color: transparent;
    }
    .ss-dpad-btn:active {
      background: rgba(91, 159, 192, 0.55);
    }
    .ss-dpad-up    { grid-column: 2; grid-row: 1; }
    .ss-dpad-left  { grid-column: 1; grid-row: 2; }
    .ss-dpad-right { grid-column: 3; grid-row: 2; }
    .ss-dpad-down  { grid-column: 2; grid-row: 3; }
  `;
  document.head.appendChild(style);
}
