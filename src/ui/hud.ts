// Top-right HUD: coins, XP, level. Phase 3 mostly displays zeros (XP ticks
// up on harvest). Phase 4 wires the economy.

import type { Player } from "../state/player";

export function createHud(parent: HTMLElement, player: Player): () => void {
  const panel = document.createElement("div");
  panel.className = "ss-panel ss-hud";
  panel.innerHTML = `
    <h3>Player</h3>
    <div class="ss-row"><span>Level</span><span data-field="level"></span></div>
    <div class="ss-row"><span>XP</span><span data-field="xp"></span></div>
    <div class="ss-row"><span>Coins</span><span data-field="coins"></span></div>
  `;
  parent.appendChild(panel);

  const levelEl = panel.querySelector('[data-field="level"]') as HTMLSpanElement;
  const xpEl = panel.querySelector('[data-field="xp"]') as HTMLSpanElement;
  const coinsEl = panel.querySelector('[data-field="coins"]') as HTMLSpanElement;

  const render = (): void => {
    levelEl.textContent = String(player.level);
    xpEl.textContent = String(player.xp);
    coinsEl.textContent = String(player.coins);
  };
  render();
  const unsubscribe = player.subscribe(render);

  return () => {
    unsubscribe();
    panel.remove();
  };
}
