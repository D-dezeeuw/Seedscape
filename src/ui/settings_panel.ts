// Settings window. Minimal for now: a single "Reset world" action that wipes
// the IndexedDB save + dev-only localStorage and reloads. Audio + key-binding
// settings will land here when those systems exist.

import { makeWindow, type UiWindow } from "./window";

const DB_NAME = "seedscape";

interface SettingsDeps {
  parent: HTMLElement;
}

export function createSettingsPanel(deps: SettingsDeps): UiWindow {
  const panel = document.createElement("div");
  panel.className = "ss-panel ss-settings";
  panel.innerHTML = `
    <h3>Settings</h3>
    <div class="ss-subhead">World</div>
    <div class="ss-row">
      <span>Reset world</span>
      <button class="ss-btn" data-act="reset">Reset…</button>
    </div>
    <div class="ss-subhead">About</div>
    <div class="ss-dim">Seedscape — early build</div>
  `;
  deps.parent.appendChild(panel);

  const handler = async (event: Event): Promise<void> => {
    const trigger = (event.target as HTMLElement | null)?.closest(
      "[data-act]",
    ) as HTMLElement | null;
    if (trigger?.dataset.act !== "reset") return;
    if (!confirm("Reset the world? This deletes your save and reloads.")) return;
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
  };
  panel.addEventListener("click", handler);

  return makeWindow(panel, () => {
    panel.removeEventListener("click", handler);
  });
}
