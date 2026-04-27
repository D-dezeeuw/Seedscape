import { describe, expect, test } from "vitest";
import { allocChunkData, type ChunkRecord, tileIndex } from "../world/chunk";
import { chunkKey } from "../world/coords";
import {
  harvestTile,
  plantSeed,
  setWaterLevel,
  tillTile,
  waterTile,
} from "../world/farming/tile_actions";
import type { EntityServices, TileWorldAccess } from "./entities/entity";
import { Villager } from "./entities/villager";
import { ITEM_IDS, type ItemId } from "./items";
import {
  executePossessedAction,
  isActionable,
  type PossessedAction,
  type ResolverTile,
  resolvePossessedAction,
} from "./possession_actions";

const TILE_DRY_GRASS = 10;
const TILE_FARMLAND_TILLED = 13;
const SHALLOW_WATER = 0;
const WHEAT_BASE = 100;
const CRATE_TILE = 220;
const SEED_DISPENSER = 221;
const MILL_TILE = 200;

function makeVillager(): Villager {
  return new Villager(1, { chunkX: 0, chunkY: 0, localX: 0.5, localY: 0.5 }, "T", { x: 0, y: 0 });
}

function tile(partial: Partial<ResolverTile> & { tileId: number }): ResolverTile {
  return {
    x: partial.x ?? 5,
    y: partial.y ?? 5,
    tileId: partial.tileId,
    state: partial.state ?? 0,
    metadata: partial.metadata ?? 0,
  };
}

const NO_SERVICES: EntityServices = {};

function expectKind(action: PossessedAction, kind: PossessedAction["kind"]): void {
  expect(action.kind).toBe(kind);
}

describe("resolvePossessedAction", () => {
  test("null tile → none", () => {
    const v = makeVillager();
    expectKind(resolvePossessedAction(v, null, NO_SERVICES), "none");
  });

  test("crate → open_container", () => {
    const v = makeVillager();
    expectKind(
      resolvePossessedAction(v, tile({ tileId: CRATE_TILE }), NO_SERVICES),
      "open_container",
    );
  });

  test("seed dispenser → open_container (passive route, not building)", () => {
    const v = makeVillager();
    expectKind(
      resolvePossessedAction(v, tile({ tileId: SEED_DISPENSER }), NO_SERVICES),
      "open_container",
    );
  });

  test("active building (mill) → open_building", () => {
    const v = makeVillager();
    expectKind(
      resolvePossessedAction(v, tile({ tileId: MILL_TILE }), NO_SERVICES),
      "open_building",
    );
  });

  test("shallow water → haul_water (when reserve below max)", () => {
    const v = makeVillager();
    v.waterReserve = 2;
    expectKind(
      resolvePossessedAction(v, tile({ tileId: SHALLOW_WATER }), NO_SERVICES),
      "haul_water",
    );
  });

  test("shallow water with full reserve → none", () => {
    const v = makeVillager();
    v.waterReserve = 5;
    expectKind(resolvePossessedAction(v, tile({ tileId: SHALLOW_WATER }), NO_SERVICES), "none");
  });

  test("ripe wheat → harvest_crop", () => {
    const v = makeVillager();
    expectKind(
      resolvePossessedAction(v, tile({ tileId: WHEAT_BASE, state: 7 }), NO_SERVICES),
      "harvest_crop",
    );
  });

  test("thirsty growing wheat with reserve → water_crop", () => {
    const v = makeVillager();
    v.waterReserve = 3;
    const t = tile({ tileId: WHEAT_BASE, state: 2, metadata: setWaterLevel(0, 0) });
    expectKind(resolvePossessedAction(v, t, NO_SERVICES), "water_crop");
  });

  test("thirsty growing wheat without reserve → blocked: need_water", () => {
    const v = makeVillager();
    v.waterReserve = 0;
    const t = tile({ tileId: WHEAT_BASE, state: 2, metadata: setWaterLevel(0, 0) });
    const action = resolvePossessedAction(v, t, NO_SERVICES);
    expect(action).toEqual({ kind: "blocked", reason: "need_water" });
  });

  test("healthy growing wheat → none (no work needed)", () => {
    const v = makeVillager();
    const t = tile({ tileId: WHEAT_BASE, state: 3, metadata: setWaterLevel(0, 3) });
    expectKind(resolvePossessedAction(v, t, NO_SERVICES), "none");
  });

  test("empty tilled tile + carrying seed → plant_seed", () => {
    const v = makeVillager();
    v.pickup(ITEM_IDS.WHEAT_SEED, 1);
    expectKind(
      resolvePossessedAction(v, tile({ tileId: TILE_FARMLAND_TILLED, state: 0 }), NO_SERVICES),
      "plant_seed",
    );
  });

  test("empty tilled tile + no seed → blocked: need_seed", () => {
    const v = makeVillager();
    const action = resolvePossessedAction(
      v,
      tile({ tileId: TILE_FARMLAND_TILLED, state: 0 }),
      NO_SERVICES,
    );
    expect(action).toEqual({ kind: "blocked", reason: "need_seed" });
  });

  test("dry grass → till", () => {
    const v = makeVillager();
    expectKind(resolvePossessedAction(v, tile({ tileId: TILE_DRY_GRASS }), NO_SERVICES), "till");
  });

  test("wilted crop → none (not actionable)", () => {
    const v = makeVillager();
    expectKind(
      resolvePossessedAction(v, tile({ tileId: WHEAT_BASE, state: 255 }), NO_SERVICES),
      "none",
    );
  });
});

describe("isActionable", () => {
  test("none and blocked are not actionable; everything else is", () => {
    expect(isActionable({ kind: "none" })).toBe(false);
    expect(isActionable({ kind: "blocked", reason: "need_water" })).toBe(false);
    expect(isActionable({ kind: "till", tile: { x: 0, y: 0 } })).toBe(true);
    expect(isActionable({ kind: "harvest_crop", tile: { x: 0, y: 0 } })).toBe(true);
  });
});

// Tile-world stub backed by one in-memory ChunkData record at (0,0).
// Mirrors the production main.ts wiring: every mutating method routes
// through the matching tile_actions helper so executor tests verify
// the same code path the god-mode tool uses.
function makeStubWorld(): { tw: TileWorldAccess; data: ReturnType<typeof allocChunkData> } {
  const data = allocChunkData();
  const rec: ChunkRecord = { data, flags: 0 };
  const map = new Map<string, ChunkRecord>([[chunkKey(0, 0), rec]]);
  const tw: TileWorldAccess = {
    readTile(wx, wy) {
      const i = tileIndex(wx, wy);
      return {
        tileId: data.tileId[i] ?? 0,
        state: data.state[i] ?? 0,
        metadata: data.metadata[i] ?? 0,
      };
    },
    harvestAt(wx, wy) {
      const r = harvestTile(data, wx, wy);
      const out: { applied: boolean; produceItem?: number; yield?: number } = {
        applied: r.applied,
      };
      if (r.produceItem !== undefined) out.produceItem = r.produceItem;
      if (r.yield !== undefined) out.yield = r.yield;
      return out;
    },
    waterAt(wx, wy) {
      return waterTile(data, wx, wy).applied;
    },
    plantSeedAt(wx, wy, seedItem) {
      return plantSeed(data, wx, wy, seedItem as ItemId).applied;
    },
    tillAt(wx, wy) {
      return tillTile(data, wx, wy).applied;
    },
    *allChunkRecords() {
      yield* map;
    },
  };
  return { tw, data };
}

describe("executePossessedAction", () => {
  test("haul_water sets reserve to max and records HAULED_WATER memory", () => {
    const { tw } = makeStubWorld();
    const v = makeVillager();
    v.waterReserve = 0;
    const services: EntityServices = { tileWorld: tw };
    const result = executePossessedAction(
      v,
      { kind: "haul_water", source: { x: 5, y: 5 } },
      services,
      42,
    );
    expect(result).toEqual({ kind: "ok" });
    expect(v.waterReserve).toBe(5);
    const types = v.shortTermMemory.filter((m) => m.type !== 0).map((m) => m.type);
    expect(types).toContain(4); // HAULED_WATER
  });

  test("water_crop drains reserve and waters the tile", () => {
    const { tw, data } = makeStubWorld();
    // Plant a thirsty wheat at (5,5).
    data.tileId[tileIndex(5, 5)] = 100;
    data.state[tileIndex(5, 5)] = 2;
    data.metadata[tileIndex(5, 5)] = setWaterLevel(0, 0);
    const v = makeVillager();
    v.waterReserve = 3;
    const result = executePossessedAction(
      v,
      { kind: "water_crop", tile: { x: 5, y: 5 } },
      { tileWorld: tw },
      0,
    );
    expect(result).toEqual({ kind: "ok" });
    expect(v.waterReserve).toBe(2);
  });

  test("harvest_crop adds produce to settler carry", () => {
    const { tw, data } = makeStubWorld();
    data.tileId[tileIndex(7, 7)] = 100; // wheat
    data.state[tileIndex(7, 7)] = 7; // ripe
    const v = makeVillager();
    const result = executePossessedAction(
      v,
      { kind: "harvest_crop", tile: { x: 7, y: 7 } },
      { tileWorld: tw },
      0,
    );
    expect(result).toEqual({ kind: "ok" });
    expect(v.carriedItems.size).toBeGreaterThan(0);
  });

  test("plant_seed consumes a seed and stamps the tile", () => {
    const { tw, data } = makeStubWorld();
    data.tileId[tileIndex(3, 3)] = 13; // tilled
    data.state[tileIndex(3, 3)] = 0;
    const v = makeVillager();
    v.pickup(ITEM_IDS.WHEAT_SEED, 1);
    const result = executePossessedAction(
      v,
      { kind: "plant_seed", tile: { x: 3, y: 3 }, seedId: ITEM_IDS.WHEAT_SEED },
      { tileWorld: tw },
      0,
    );
    expect(result).toEqual({ kind: "ok" });
    expect(v.carriedItems.get(ITEM_IDS.WHEAT_SEED) ?? 0).toBe(0);
    expect(data.tileId[tileIndex(3, 3)]).toBe(100); // wheat seedling
  });

  test("till stamps farmland over dry grass", () => {
    const { tw, data } = makeStubWorld();
    data.tileId[tileIndex(2, 2)] = 10; // dry grass
    const v = makeVillager();
    const result = executePossessedAction(
      v,
      { kind: "till", tile: { x: 2, y: 2 } },
      { tileWorld: tw },
      0,
    );
    expect(result).toEqual({ kind: "ok" });
    expect(data.tileId[tileIndex(2, 2)]).toBe(13);
  });

  test("open_container returns container coords for the caller to open the window", () => {
    const v = makeVillager();
    const result = executePossessedAction(
      v,
      { kind: "open_container", container: { x: 4, y: 4 }, label: "Storage Crate" },
      {},
      0,
    );
    expect(result).toEqual({ kind: "open_container", container: { x: 4, y: 4 } });
  });

  test("blocked / none → noop", () => {
    const v = makeVillager();
    expect(executePossessedAction(v, { kind: "none" }, {}, 0)).toEqual({ kind: "noop" });
    expect(executePossessedAction(v, { kind: "blocked", reason: "need_seed" }, {}, 0)).toEqual({
      kind: "noop",
    });
  });
});
