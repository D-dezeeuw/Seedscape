// Lightweight user-preference store. Lives outside the IndexedDB save
// because preferences are per-device, not per-world: a player swapping
// between phone and desktop expects each device to remember its own
// "Tile info: OFF" choice. localStorage is the right fit.
//
// Today: tile-info on/off. Future toggles (HUD / FPS / colour-blind
// palette) slot in here.

const STORAGE_KEY = "seedscape.preferences.v1";

export interface Preferences {
  tileInfoEnabled: boolean;
  // Seed to use for the next freshly generated world. Set by the
  // settings panel before a Reset; consumed once on boot when no save
  // exists, then cleared to null.
  pendingWorldSeed: number | null;
}

const DEFAULTS: Preferences = {
  tileInfoEnabled: true,
  pendingWorldSeed: null,
};

type Listener = (prefs: Preferences) => void;

class PreferenceStore {
  private prefs: Preferences = { ...DEFAULTS };
  private readonly listeners = new Set<Listener>();

  constructor() {
    this.load();
  }

  get(): Preferences {
    return this.prefs;
  }

  set<K extends keyof Preferences>(key: K, value: Preferences[K]): void {
    if (this.prefs[key] === value) return;
    this.prefs = { ...this.prefs, [key]: value };
    this.save();
    for (const cb of this.listeners) cb(this.prefs);
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    cb(this.prefs);
    return () => this.listeners.delete(cb);
  }

  private load(): void {
    if (typeof localStorage === "undefined") return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<Preferences>;
      this.prefs = { ...DEFAULTS, ...parsed };
    } catch {
      // Corrupt prefs — fall back to defaults rather than crashing the app.
      this.prefs = { ...DEFAULTS };
    }
  }

  private save(): void {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.prefs));
    } catch {
      // Quota exceeded / private mode — silently drop. Worst case the
      // toggle stops persisting; the in-session state still works.
    }
  }
}

export const preferences = new PreferenceStore();
