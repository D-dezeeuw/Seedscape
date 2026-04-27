// Building window — opens when the player clicks a Mill or Bakery tile
// in god mode. Three sections:
//   - Status: cycle progress + queued count + buffer headroom
//   - Input: items waiting to be consumed by the building, with manual
//     "+1 / +cycle / all" buttons that push from inventory into the
//     input buffer (the auto-queue tick will then start a cycle).
//   - Output: items produced and waiting to be hauled, with "−1 / −10 /
//     take all" buttons that pull from the output buffer into inventory.
//
// Mirrors container_window's pattern. Re-renders on inventory.subscribe
// + a 4 Hz polling timer because the building buffer doesn't expose a
// subscription (the auto-queue tick + sim handler mutate it from the
// main thread, but settler-driven changes also flow through the same
// store, and polling at 4 Hz catches them all).

import type { Inventory } from "../state/inventory";
import { getItemDef, type ItemId } from "../state/items";
import type { BuildingBufferStore } from "../world/farming/building_buffer";
import { buildingInputCap, buildingOutputCap } from "../world/farming/building_buffer_tick";
import {
  type BuildingDef,
  buildingForTile,
  getQueuedJobs,
} from "../world/farming/building_registry";
import { makeWindow } from "./window";

const REFRESH_HZ = 4;

export interface BuildingWindowDeps {
  parent: HTMLElement;
  inventory: Inventory;
  buffers: BuildingBufferStore;
  // Live tile lookup. Returns { tileId, state, metadata } or null when
  // the chunk has been evicted / the tile dismantled. The window uses
  // tileId to verify the building hasn't changed and state/metadata to
  // render cycle progress + queued count.
  readTile: (x: number, y: number) => { tileId: number; state: number; metadata: number } | null;
  toast?: (message: string) => void;
}

export interface BuildingWindowApi {
  showFor: (x: number, y: number) => void;
  destroy: () => void;
}

interface OpenTarget {
  x: number;
  y: number;
  tileId: number;
  def: BuildingDef;
}

export function createBuildingWindow(deps: BuildingWindowDeps): BuildingWindowApi {
  const panel = document.createElement("div");
  panel.className = "ss-panel ss-building-window";
  panel.innerHTML = `
    <h3 data-field="title">Building</h3>
    <div class="ss-meta" data-field="meta"></div>
    <div class="ss-subhead">Status</div>
    <div data-field="status"></div>
    <div class="ss-subhead">Input buffer</div>
    <div data-field="input"></div>
    <div class="ss-subhead">Output buffer</div>
    <div data-field="output"></div>
  `;
  deps.parent.appendChild(panel);

  const titleEl = panel.querySelector('[data-field="title"]') as HTMLElement;
  const metaEl = panel.querySelector('[data-field="meta"]') as HTMLElement;
  const statusEl = panel.querySelector('[data-field="status"]') as HTMLDivElement;
  const inputEl = panel.querySelector('[data-field="input"]') as HTMLDivElement;
  const outputEl = panel.querySelector('[data-field="output"]') as HTMLDivElement;

  let target: OpenTarget | null = null;
  const window_ = makeWindow(panel, () => {});

  const render = (): void => {
    if (!target) return;
    const live = deps.readTile(target.x, target.y);
    if (!live || live.tileId !== target.tileId) {
      // Building was dismantled / replaced — close cleanly.
      window_.hide();
      return;
    }
    const def = target.def;
    titleEl.textContent = def.displayName;
    metaEl.textContent = `(${target.x}, ${target.y}) · cycle ${def.cycleTime}s`;

    // Status: progress (state = ticks elapsed in current cycle, 0 = idle),
    // queued cycles, and a tiny buffer headroom hint.
    const queued = getQueuedJobs(live.metadata);
    const progress = live.state;
    const inputCap = buildingInputCap(def.inputQuantity);
    const outputCap = buildingOutputCap(def.outputQuantity);
    const inputHave = deps.buffers.totalInputAt(target.x, target.y);
    const outputHave = deps.buffers.totalOutputAt(target.x, target.y);
    statusEl.innerHTML = "";
    statusEl.appendChild(
      infoRow("Cycle", progress === 0 ? "idle" : `${progress}/${def.cycleTime}`),
    );
    statusEl.appendChild(infoRow("Queued", String(queued)));
    statusEl.appendChild(infoRow("Input", `${inputHave}/${inputCap}`));
    statusEl.appendChild(infoRow("Output", `${outputHave}/${outputCap}`));

    // Input buffer + deposit-from-inventory.
    inputEl.innerHTML = "";
    const acceptedInput = def.inputItem;
    const inputCount = deps.buffers.inputAt(target.x, target.y, acceptedInput);
    const haveInInventory = deps.inventory.count(acceptedInput);
    inputEl.appendChild(
      buildInputRow(acceptedInput, inputCount, haveInInventory, def, target, deps, render),
    );

    // Output buffer + withdraw-to-inventory. Walk all output entries
    // because a building's output is a single item kind today, but the
    // buffer is item-typed so future multi-output buildings work cleanly.
    outputEl.innerHTML = "";
    const outputItem = def.outputItem;
    const outputCount = deps.buffers.outputAt(target.x, target.y, outputItem);
    if (outputCount > 0) {
      outputEl.appendChild(buildOutputRow(outputItem, outputCount, target, deps, render));
    } else {
      outputEl.innerHTML = `<div class="ss-empty">empty</div>`;
    }
  };

  const refreshIntervalMs = Math.round(1000 / REFRESH_HZ);
  const refreshTimer = window.setInterval(() => {
    if (target && window_.isOpen()) render();
  }, refreshIntervalMs);
  const unsubscribe = deps.inventory.subscribe(() => {
    if (target && window_.isOpen()) render();
  });

  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key !== "Escape") return;
    if (!window_.isOpen()) return;
    window_.hide();
    ev.preventDefault();
  };
  globalThis.window.addEventListener("keydown", onKey);

  return {
    showFor(x: number, y: number) {
      const live = deps.readTile(x, y);
      if (!live) return;
      const def = buildingForTile(live.tileId);
      // Only open for ACTIVE buildings (mill, bakery). Crates/dispensers
      // route through container_window; passive defs return early.
      if (!def || def.passive) return;
      target = { x, y, tileId: live.tileId, def };
      render();
      if (!window_.isOpen()) window_.show();
    },
    destroy() {
      globalThis.window.clearInterval(refreshTimer);
      globalThis.window.removeEventListener("keydown", onKey);
      unsubscribe();
      window_.destroy();
    },
  };
}

// ---- helpers ----------------------------------------------------------

function infoRow(label: string, value: string): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "ss-row";
  row.innerHTML = `<span>${label}</span><span>${value}</span>`;
  return row;
}

function buildInputRow(
  itemId: ItemId,
  bufferCount: number,
  inventoryCount: number,
  def: BuildingDef,
  target: OpenTarget,
  deps: BuildingWindowDeps,
  rerender: () => void,
): HTMLDivElement {
  const itemDef = getItemDef(itemId);
  const row = document.createElement("div");
  row.className = "ss-row";
  // "+cycle" button feeds exactly one cycle's worth — common case for
  // a player who just wants to fast-forward production.
  row.innerHTML = `
    <span>${itemDef.displayName}</span>
    <span class="ss-row-actions">
      <span class="ss-row-count">${bufferCount} (you: ${inventoryCount})</span>
      <button class="ss-btn ss-btn-tight" data-amt="1">+1</button>
      <button class="ss-btn ss-btn-tight" data-amt="cycle">+cycle</button>
      <button class="ss-btn ss-btn-tight" data-amt="all">all</button>
    </span>
  `;
  row.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement | null)?.closest("[data-amt]") as HTMLElement | null;
    if (!btn) return;
    const raw = btn.dataset.amt as "1" | "cycle" | "all";
    const wanted = raw === "all" ? inventoryCount : raw === "cycle" ? def.inputQuantity : 1;
    const amount = Math.min(inventoryCount, wanted);
    if (amount <= 0) return;
    const cap = buildingInputCap(def.inputQuantity);
    const stored = deps.buffers.addInput(target.x, target.y, itemId, amount, cap);
    if (stored > 0) deps.inventory.remove(itemId, stored);
    if (stored < amount) {
      deps.toast?.(`Input full — ${stored}/${amount} stored`);
    }
    rerender();
  });
  return row;
}

function buildOutputRow(
  itemId: ItemId,
  count: number,
  target: OpenTarget,
  deps: BuildingWindowDeps,
  rerender: () => void,
): HTMLDivElement {
  const itemDef = getItemDef(itemId);
  const row = document.createElement("div");
  row.className = "ss-row";
  row.innerHTML = `
    <span>${itemDef.displayName}</span>
    <span class="ss-row-actions">
      <span class="ss-row-count">${count}</span>
      <button class="ss-btn ss-btn-tight" data-amt="1">−1</button>
      <button class="ss-btn ss-btn-tight" data-amt="10">−10</button>
      <button class="ss-btn ss-btn-tight" data-amt="all">take</button>
    </span>
  `;
  row.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement | null)?.closest("[data-amt]") as HTMLElement | null;
    if (!btn) return;
    const raw = btn.dataset.amt as "1" | "10" | "all";
    const wanted = raw === "all" ? count : Number(raw);
    const amount = Math.min(count, wanted);
    if (amount <= 0) return;
    const taken = deps.buffers.consumeOutput(target.x, target.y, itemId, amount);
    if (taken > 0) deps.inventory.add(itemId, taken);
    rerender();
  });
  return row;
}
