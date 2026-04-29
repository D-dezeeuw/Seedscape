// Settings window. Minimal for now: "Save now" forces an IndexedDB
// sync, "Reset world" wipes the save and reloads. Audio + key-binding
// settings will land here when those systems exist.

import { preferences } from "../state/preferences";
import { makeWindow, type UiWindow } from "./window";

const DB_NAME = "seedscape";

interface SettingsDeps {
  parent: HTMLElement;
  // Active world seed shown read-only in the panel — sourced from the
  // loaded snapshot or the resolved fresh-world seed at boot.
  currentSeed: number;
  // Force-save callback. Returns the save promise so the button can
  // surface a "saved" toast when it resolves. Provided by main.ts —
  // mirrors the autosave path but bypasses the every-30s gate.
  onSaveNow: () => Promise<void>;
  toast?: (message: string) => void;
}

// Parse a user-typed seed. Accepts decimal ("12345"), hex ("0xC0FFEE"),
// or any other string (hashed via a 32-bit mixer so "bloomridge" reliably
// maps to the same seed across runs). Returns a 32-bit-safe integer.
function parseSeed(raw: string): number {
  const s = raw.trim();
  if (s.length === 0) return 0;
  // Decimal or hex literal first — keeps round-tripping with the
  // displayed `0x...` form trivial.
  if (/^-?\d+$/.test(s) || /^-?0x[0-9a-f]+$/i.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) return n | 0;
  }
  // Fallback: cyrb53-style mix folded into 32 bits. Stable across runs;
  // distribution is fine for the simplex-noise XOR we feed it into.
  let h1 = 0xdeadbeef ^ s.length;
  let h2 = 0x41c6ce57 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  return h1 | 0;
}

function formatSeed(seed: number): string {
  return `0x${(seed >>> 0).toString(16)}`;
}

export function createSettingsPanel(deps: SettingsDeps): UiWindow {
  const panel = document.createElement("div");
  panel.className = "ss-panel ss-settings";
  panel.innerHTML = `
    <h3>Settings</h3>
    <div class="ss-subhead">Display</div>
    <div class="ss-row">
      <span>Tile info</span>
      <button class="ss-btn" data-act="tile-info" data-field="tile-info-label">On</button>
    </div>
    <div class="ss-subhead">World</div>
    <div class="ss-row">
      <span>Seed</span>
      <span class="ss-dim">${formatSeed(deps.currentSeed)}</span>
    </div>
    <div class="ss-row">
      <span>Save now</span>
      <button class="ss-btn" data-act="save">Save</button>
    </div>
    <div class="ss-row">
      <span>Reset world</span>
      <span class="ss-row-actions">
        <input class="ss-input" data-field="seed-input" placeholder="seed (optional)" />
        <button class="ss-btn" data-act="reset">Reset…</button>
      </span>
    </div>
    <div class="ss-subhead">About</div>
    <div class="ss-dim">Seedscape — early build</div>
  `;
  deps.parent.appendChild(panel);

  // Tile-info toggle reads + writes the global preference. Subscribe
  // so the label tracks external changes (e.g., a future hotkey).
  const tileInfoLabel = panel.querySelector(
    '[data-field="tile-info-label"]',
  ) as HTMLButtonElement | null;
  const refreshTileInfoLabel = (): void => {
    if (tileInfoLabel) {
      tileInfoLabel.textContent = preferences.get().tileInfoEnabled ? "On" : "Off";
    }
  };
  const unsubscribePrefs = preferences.subscribe(refreshTileInfoLabel);

  // Normalise the seed input to the canonical hex form on blur. Lets a
  // user type "bloomridge", tab out, and see the integer they're about
  // to commit so they can copy/share the actual seed.
  const seedInput = panel.querySelector('[data-field="seed-input"]') as HTMLInputElement | null;
  const onSeedBlur = (): void => {
    if (!seedInput) return;
    const raw = seedInput.value.trim();
    if (raw.length === 0) return;
    seedInput.value = formatSeed(parseSeed(raw));
  };
  seedInput?.addEventListener("blur", onSeedBlur);

  const handler = async (event: Event): Promise<void> => {
    const trigger = (event.target as HTMLElement | null)?.closest(
      "[data-act]",
    ) as HTMLElement | null;
    const action = trigger?.dataset.act;
    if (action === "tile-info") {
      preferences.set("tileInfoEnabled", !preferences.get().tileInfoEnabled);
      return;
    }
    if (action === "save") {
      const btn = trigger as HTMLButtonElement;
      btn.disabled = true;
      btn.textContent = "Saving…";
      try {
        await deps.onSaveNow();
        deps.toast?.("World saved.");
      } catch (err) {
        console.error("manual save failed", err);
        deps.toast?.("Save failed — see console.");
      } finally {
        btn.disabled = false;
        btn.textContent = "Save";
      }
      return;
    }
    if (action === "reset") {
      if (!confirm("Reset the world? This deletes your save and reloads.")) return;
      // Read the seed input *before* the IndexedDB delete races the reload,
      // so a non-empty value always lands in preferences for the next boot
      // to consume.
      const rawSeed = seedInput?.value ?? "";
      if (rawSeed.trim().length > 0) {
        preferences.set("pendingWorldSeed", parseSeed(rawSeed));
      }
      try {
        await new Promise<void>((resolve, reject) => {
          const req = indexedDB.deleteDatabase(DB_NAME);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error ?? new Error("delete failed"));
          req.onblocked = () => resolve(); // proceed; reload will close handles
        });
      } catch (err) {
        console.error("reset failed", err);
      }
      location.reload();
    }
  };
  panel.addEventListener("click", handler);

  return makeWindow(panel, () => {
    panel.removeEventListener("click", handler);
    seedInput?.removeEventListener("blur", onSeedBlur);
    unsubscribePrefs();
  });
}
