// Top-right HUD: level, XP-to-next bar, coins. Phase 4 wires the economy so
// these all update from gameplay events.

import { levelProgress } from "../state/level";
import type { Player } from "../state/player";
import { wrapPanelStructure } from "./window";

export function createHud(parent: HTMLElement, player: Player): () => void {
  const panel = document.createElement("div");
  panel.className = "ss-panel ss-hud";
  panel.innerHTML = `
    <h3>Player</h3>
    <div class="ss-row"><span>Level</span><span data-field="level"></span></div>
    <div class="ss-xpbar"><div class="ss-xpbar-fill" data-field="xpfill"></div></div>
    <div class="ss-row"><span>XP</span><span data-field="xp"></span></div>
    <div class="ss-row"><span>Coins</span><span data-field="coins"></span></div>
  `;
  parent.appendChild(panel);
  wrapPanelStructure(panel);

  const levelEl = panel.querySelector('[data-field="level"]') as HTMLSpanElement;
  const xpEl = panel.querySelector('[data-field="xp"]') as HTMLSpanElement;
  const coinsEl = panel.querySelector('[data-field="coins"]') as HTMLSpanElement;
  const xpFillEl = panel.querySelector('[data-field="xpfill"]') as HTMLDivElement;

  const render = (): void => {
    const progress = levelProgress(player.xp);
    levelEl.textContent = String(progress.level);
    xpEl.textContent = `${progress.xpIntoLevel} / ${progress.xpForNextLevel}`;
    coinsEl.textContent = String(player.coins);
    const pct = Math.min(100, (progress.xpIntoLevel / Math.max(1, progress.xpForNextLevel)) * 100);
    xpFillEl.style.width = `${pct}%`;
  };
  render();
  const unsubscribe = player.subscribe(render);

  return () => {
    unsubscribe();
    panel.remove();
  };
}
