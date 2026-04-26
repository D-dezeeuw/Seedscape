// Player progression state. Phase 3 wired the fields without earning; Phase 4
// hooks XP earn (harvest, sell, production cycle), coin earn (NPC sell), coin
// spend (shop), and recomputes level + unlock set on every XP change.
//
// Notification channel mirrors Inventory so the HUD can re-render on change.

import { levelForXp } from "./level";
import { newUnlocksAtLevel } from "./unlocks";

export interface PlayerSnapshot {
  coins: number;
  xp: number;
  // `level` is derived from xp and stored only for save round-trip; on load
  // we recompute it so a tweak to the XP curve doesn't strand old saves.
  level: number;
}

export type PlayerListener = (snapshot: PlayerSnapshot) => void;
// Fired once per level-up with the level the player just reached. UI uses
// this to show a "new unlocks!" toast.
export type LevelUpListener = (newLevel: number) => void;

export class Player {
  private _coins = 0;
  private _xp = 0;
  private _level = 1;
  private readonly listeners = new Set<PlayerListener>();
  private readonly levelUpListeners = new Set<LevelUpListener>();

  get coins(): number {
    return this._coins;
  }
  get xp(): number {
    return this._xp;
  }
  get level(): number {
    return this._level;
  }

  // Setters validate (non-negative). Gameplay code should prefer addCoins
  // / spendCoins / addXp; the bare setters are for the debug panel reset
  // ("xp = 0") and future save migrations. Throwing on negative input
  // means an upstream bug surfaces immediately instead of silently
  // entering negative-balance state.
  set coins(value: number) {
    if (value < 0) throw new Error(`Player.coins must be >= 0, got ${value}`);
    if (value === this._coins) return;
    this._coins = value;
    this.fire();
  }

  set xp(value: number) {
    if (value < 0) throw new Error(`Player.xp must be >= 0, got ${value}`);
    this.setXp(value);
  }

  addXp(amount: number): void {
    if (amount <= 0) return;
    this.setXp(this._xp + amount);
  }

  addCoins(amount: number): void {
    if (amount <= 0) return;
    this._coins += amount;
    this.fire();
  }

  // Returns false if the player can't afford the cost; state unchanged.
  spendCoins(amount: number): boolean {
    if (amount < 0) throw new Error(`Player.spendCoins expects amount >= 0, got ${amount}`);
    if (amount === 0) return true;
    if (this._coins < amount) return false;
    this._coins -= amount;
    this.fire();
    return true;
  }

  toJSON(): PlayerSnapshot {
    return { coins: this._coins, xp: this._xp, level: this._level };
  }

  loadFromJSON(snapshot: PlayerSnapshot): void {
    this._coins = snapshot.coins;
    this._xp = snapshot.xp;
    // Always recompute level from xp on load — the XP curve is the source of
    // truth, the saved level is just a presentation cache.
    this._level = levelForXp(this._xp);
    this.fire();
  }

  subscribe(listener: PlayerListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeLevelUp(listener: LevelUpListener): () => void {
    this.levelUpListeners.add(listener);
    return () => this.levelUpListeners.delete(listener);
  }

  private setXp(value: number): void {
    if (value === this._xp) return;
    const previousLevel = this._level;
    this._xp = value;
    const nextLevel = levelForXp(value);
    this._level = nextLevel;
    this.fire();
    // Walk every level crossed (handles big XP grants from save/load too).
    if (nextLevel > previousLevel) {
      for (let lvl = previousLevel + 1; lvl <= nextLevel; lvl++) {
        // Only fire if there's something interesting at that level — the
        // listener decides what to do with it (UI toast, sound, etc).
        if (newUnlocksAtLevel(lvl).length > 0 || lvl === nextLevel) {
          for (const listener of this.levelUpListeners) listener(lvl);
        }
      }
    }
  }

  private fire(): void {
    const snap = this.toJSON();
    for (const listener of this.listeners) listener(snap);
  }
}
