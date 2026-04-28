// Settings window. Minimal for now: "Save now" forces an IndexedDB
// sync, "Reset world" wipes the save and reloads. Audio + key-binding
// settings will land here when those systems exist.

import { makeWindow, type UiWindow } from "./window";

const DB_NAME = "seedscape";

interface SettingsDeps {
  parent: HTMLElement;
  // Force-save callback. Returns the save promise so the button can
  // surface a "saved" toast when it resolves. Provided by main.ts —
  // mirrors the autosave path but bypasses the every-30s gate.
  onSaveNow: () => Promise<void>;
  toast?: (message: string) => void;
}

export function createSettingsPanel(deps: SettingsDeps): UiWindow {
  const panel = document.createElement("div");
  panel.className = "ss-panel ss-settings";
  panel.innerHTML = `
    <h3>Settings</h3>
    <div class="ss-subhead">World</div>
    <div class="ss-row">
      <span>Save now</span>
      <button class="ss-btn" data-act="save">Save</button>
    </div>
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
    const action = trigger?.dataset.act;
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
  });
}
