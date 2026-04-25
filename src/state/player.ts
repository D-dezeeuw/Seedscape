// Player progression state. Phase 3 wires the fields but doesn't earn from
// them; Phase 4 hooks the economy in. Notification channel mirrors Inventory
// so the HUD can re-render on change.

export interface PlayerSnapshot {
  coins: number;
  xp: number;
  level: number;
}

export type PlayerListener = (snapshot: PlayerSnapshot) => void;

export class Player {
  private _coins = 0;
  private _xp = 0;
  private _level = 1;
  private readonly listeners = new Set<PlayerListener>();

  get coins(): number {
    return this._coins;
  }
  get xp(): number {
    return this._xp;
  }
  get level(): number {
    return this._level;
  }

  set coins(value: number) {
    if (value === this._coins) return;
    this._coins = value;
    this.fire();
  }
  set xp(value: number) {
    if (value === this._xp) return;
    this._xp = value;
    this.fire();
  }
  set level(value: number) {
    if (value === this._level) return;
    this._level = value;
    this.fire();
  }

  toJSON(): PlayerSnapshot {
    return { coins: this._coins, xp: this._xp, level: this._level };
  }

  loadFromJSON(snapshot: PlayerSnapshot): void {
    this._coins = snapshot.coins;
    this._xp = snapshot.xp;
    this._level = snapshot.level;
    this.fire();
  }

  subscribe(listener: PlayerListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private fire(): void {
    const snap = this.toJSON();
    for (const listener of this.listeners) listener(snap);
  }
}
