// Person window — full entity detail panel. Opens via Settlers-list row
// click or in-world entity click. Content is rendered as a stack of
// independent "sections", each gated by a predicate over the entity, so
// adding new domains (memory display, relationships, work assignments)
// is a matter of pushing a new section into SECTIONS — the panel,
// refresh loop, and selection plumbing don't change.
//
// Sections re-render at REFRESH_HZ while the panel is open, so values
// that change frame-to-frame (position, future needs decay) stay live
// without paying the cost when the panel is hidden.

import { Animal, Mount, Pet } from "../state/entities/animal";
import type { Entity } from "../state/entities/entity";
import {
  LivingEntity,
  MEMORY_EVENT_TYPES,
  type MemoryEvent,
} from "../state/entities/living_entity";
import { ITEM_DEFS } from "../state/items";
import { Villager } from "../state/entities/villager";
import {
  JOB_KIND_HARVEST_CROP,
  JOB_KIND_HAUL_SEED,
  JOB_KIND_HAUL_WATER,
  JOB_KIND_PLANT_SEED,
  JOB_KIND_WATER_CROP,
  type JobKind,
} from "../state/jobs";
import { makeWindow } from "./window";

const REFRESH_HZ = 4;

export interface PersonWindowApi {
  showFor: (entity: Entity) => void;
  destroy: () => void;
}

interface Deps {
  parent: HTMLElement;
  onPossess: (entity: Entity) => void;
  // Fires when the panel becomes visible for an entity (used to drive
  // the in-world selection highlight).
  onShow?: (entity: Entity) => void;
  // Fires when the panel hides — via × button, ESC, or another window.
  onHide?: () => void;
}

// ---------- Section provider contract ----------

interface DetailSection {
  title: string;
  applies: (e: Entity) => boolean;
  render: (e: Entity) => string;
}

const row = (label: string, value: string | number): string =>
  `<div class="ss-row"><span>${label}</span><span>${value}</span></div>`;

const empty = (text: string): string => `<div class="ss-empty">${text}</div>`;

// ---------- Concrete sections ----------

const IDENTITY: DetailSection = {
  title: "Identity",
  applies: () => true,
  render: (e) => {
    const name = e instanceof Villager ? e.name : prettifyType(e);
    const out = [row("Name", name), row("Type", e.type), row("Id", e.id)];
    if (e instanceof Animal) out.push(row("Species", e.species));
    if (e instanceof Pet) {
      out.push(row("Owner", e.ownerId === null ? "—" : `#${e.ownerId}`));
      out.push(row("Follow radius", e.followRadius));
    }
    if (e instanceof Mount) {
      out.push(row("Ridden", e.ridden ? "yes" : "no"));
      out.push(row("Rider", e.riderId === null ? "—" : `#${e.riderId}`));
    }
    return out.join("");
  },
};

const LOCATION: DetailSection = {
  title: "Location",
  applies: () => true,
  render: (e) => {
    const out = [
      row("World tile", `${e.worldTileX()}, ${e.worldTileY()}`),
      row("Chunk", `${e.chunkX}, ${e.chunkY}`),
      row("Local", `${e.localX.toFixed(2)}, ${e.localY.toFixed(2)}`),
      row("Facing", facingLabel(e.facing)),
    ];
    if (e instanceof Villager) out.push(row("Home", `${e.homeWorldTileX}, ${e.homeWorldTileY}`));
    if (e instanceof Animal) out.push(row("Pen", `${e.penWorldTileX}, ${e.penWorldTileY}`));
    return out.join("");
  },
};

const NEEDS: DetailSection = {
  title: "Needs",
  applies: (e) => e instanceof LivingEntity,
  render: (e) => {
    const n = (e as LivingEntity).needs;
    return [
      row("Hunger", `${n.hunger}/255`),
      row("Sleep", `${n.sleep}/255`),
      row("Cleanliness", `${n.cleanliness}/255`),
      row("Toilet", `${n.toilet}/255`),
      row("Social", `${n.social}/255`),
      row("Mood", `${n.mood}/255`),
    ].join("");
  },
};

const TRAITS: DetailSection = {
  title: "Traits",
  applies: (e) => e instanceof LivingEntity,
  render: (e) => {
    const t = (e as LivingEntity).traits;
    return row("Packed bits", `0b${t.toString(2).padStart(8, "0")}`);
  },
};

const SHORT_TERM_MEMORY: DetailSection = {
  title: "Short-term memory",
  applies: (e) => e instanceof LivingEntity,
  render: (e) => {
    const buf = (e as LivingEntity).shortTermMemory;
    const events = buf
      .filter((m) => m.type !== 0)
      // Newest first — shortTermHead points at the next slot to write,
      // so events ordered by tick descending give the most recent at top.
      .slice()
      .sort((a, b) => b.tick - a.tick);
    if (events.length === 0) return empty("no recent events");
    return events.map(renderMemoryEvent).join("");
  },
};

const LONG_TERM_MEMORY: DetailSection = {
  title: "Long-term memory",
  applies: (e) => e instanceof LivingEntity,
  render: (e) => {
    const events = (e as LivingEntity).longTermMemory;
    if (events.length === 0) return empty("no lasting memories");
    return events
      .map((m) => row(`type ${m.type}`, `weight ${m.weight} · last ${m.lastTick}`))
      .join("");
  },
};

const JOB: DetailSection = {
  title: "Job",
  applies: (e) => e instanceof Villager,
  render: (e) => {
    const v = e as Villager;
    const stateName = v.jobs.currentStateName();
    const jobId = v.jobs.currentJobId();
    const phase = v.jobs.currentPhase();
    const waypoints = v.jobs.currentWaypoints();
    const out = [
      row("State", stateName),
      row("Water reserve", `${v.waterReserve}/5`),
      row("Carrying", carriedSummary(v)),
    ];
    if (jobId !== null) out.push(row("Job id", `#${jobId}`));
    if (phase !== null) out.push(row("Phase", phase));
    if (waypoints && waypoints.length > 0) {
      const idx = v.jobs.currentWaypointIdx() ?? 0;
      out.push(row("Waypoints", `${idx / 2}/${waypoints.length / 2}`));
    }
    return out.join("");
  },
};

const SECTIONS: DetailSection[] = [
  IDENTITY,
  LOCATION,
  JOB,
  NEEDS,
  TRAITS,
  SHORT_TERM_MEMORY,
  LONG_TERM_MEMORY,
];

function carriedSummary(v: Villager): string {
  const parts: string[] = [];
  for (const [item, count] of v.carriedItems) parts.push(`${count}×#${item}`);
  return parts.length === 0 ? "—" : parts.join(", ");
}

// Currently unused but kept for the future "name the kind" needs of an
// in-world tooltip. Removing now would mean re-deriving it later.
export function jobKindLabel(kind: JobKind): string {
  switch (kind) {
    case JOB_KIND_HAUL_WATER:
      return "Haul water";
    case JOB_KIND_WATER_CROP:
      return "Water crop";
    case JOB_KIND_HARVEST_CROP:
      return "Harvest crop";
    case JOB_KIND_PLANT_SEED:
      return "Plant seed";
    case JOB_KIND_HAUL_SEED:
      return "Haul seed";
  }
}

// ---------- Panel ----------

export function createPersonWindow(deps: Deps): PersonWindowApi {
  const panel = document.createElement("div");
  panel.className = "ss-panel ss-person";
  panel.innerHTML = `
    <h3><span data-field="name">Person</span></h3>
    <div data-field="sections"></div>
    <div class="ss-debug-row" style="margin-top: 8px;">
      <button class="ss-btn" data-act="possess">Possess</button>
    </div>
  `;
  deps.parent.appendChild(panel);

  const nameEl = panel.querySelector('[data-field="name"]') as HTMLElement;
  const sectionsEl = panel.querySelector('[data-field="sections"]') as HTMLElement;
  const possessBtn = panel.querySelector('[data-act="possess"]') as HTMLButtonElement;

  let current: Entity | null = null;
  const window_ = makeWindow(panel, () => {});
  // Mirror window open/close into the optional callbacks. The toolbar
  // and × button both go through window_.hide() so onChange catches
  // every transition.
  window_.onChange((open) => {
    if (open && current) deps.onShow?.(current);
    if (!open) deps.onHide?.();
  });

  const renderSections = (e: Entity): void => {
    let html = "";
    for (const s of SECTIONS) {
      if (!s.applies(e)) continue;
      html += `<div class="ss-subhead">${s.title}</div>${s.render(e)}`;
    }
    sectionsEl.innerHTML = html;
  };

  const renderAll = (e: Entity): void => {
    nameEl.textContent = e instanceof Villager ? e.name : prettifyType(e);
    renderSections(e);
  };

  // Live refresh while visible. Cheap — renders only the section bodies,
  // and only when the panel is open.
  const refreshIntervalMs = Math.round(1000 / REFRESH_HZ);
  const refreshTimer = window.setInterval(() => {
    if (current && window_.isOpen()) renderSections(current);
  }, refreshIntervalMs);

  possessBtn.addEventListener("click", () => {
    if (current) deps.onPossess(current);
  });

  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key !== "Escape") return;
    if (!window_.isOpen()) return;
    window_.hide();
    // Mark the event consumed so the global possession-exit ESC handler
    // doesn't also fire — closing a window wins the priority chain.
    ev.preventDefault();
  };
  globalThis.window.addEventListener("keydown", onKey);

  return {
    showFor(entity: Entity) {
      current = entity;
      renderAll(entity);
      if (!window_.isOpen()) window_.show();
    },
    destroy() {
      globalThis.window.clearInterval(refreshTimer);
      globalThis.window.removeEventListener("keydown", onKey);
      window_.destroy();
    },
  };
}

// ---------- Helpers ----------

function facingLabel(f: number): string {
  return ["South", "West", "North", "East"][f] ?? "?";
}

function prettifyType(e: Entity): string {
  return e.type.charAt(0).toUpperCase() + e.type.slice(1);
}

function renderMemoryEvent(m: MemoryEvent): string {
  return row(`t${m.tick}`, memoryEventLabel(m));
}

// Human-readable label for a memory event. Action events (Phase 7) get
// a verb + item + tile suffix; unknown / future event types fall back
// to the raw enum number so a missing translation is at least debuggable.
function memoryEventLabel(m: MemoryEvent): string {
  const tile = m.tileX !== 0 || m.tileY !== 0 ? ` at (${m.tileX}, ${m.tileY})` : "";
  switch (m.type) {
    case MEMORY_EVENT_TYPES.HARVESTED:
      return `Harvested ${itemName(m.subjectId)}${tile}`;
    case MEMORY_EVENT_TYPES.PLANTED:
      return `Planted ${itemName(m.subjectId)}${tile}`;
    case MEMORY_EVENT_TYPES.WATERED: {
      const what = m.subjectId !== 0 ? ` ${itemName(m.subjectId)}` : " a crop";
      return `Watered${what}${tile}`;
    }
    case MEMORY_EVENT_TYPES.HAULED_WATER:
      return `Filled water${tile}`;
    case MEMORY_EVENT_TYPES.HAULED_SEED:
      return `Picked up ${itemName(m.subjectId)}${tile}`;
    case MEMORY_EVENT_TYPES.DEPOSITED:
      return `Stored ${itemName(m.subjectId)}${tile}`;
    default:
      return `Event #${m.type}${tile}`;
  }
}

// Display name for an item id; falls back to "#id" for unknown ids
// (e.g., if a future seed/produce isn't yet in ITEM_DEFS).
function itemName(itemId: number): string {
  const def = ITEM_DEFS.get(itemId as Parameters<typeof ITEM_DEFS.get>[0]);
  return def?.displayName ?? `#${itemId}`;
}
