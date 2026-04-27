import { describe, expect, test } from "vitest";
import { setWaterLevel } from "../world/farming/tile_actions";
import type { EntityServices } from "./entities/entity";
import { Villager } from "./entities/villager";
import { ITEM_IDS } from "./items";
import { isActionable, type PossessedAction, resolvePossessedAction, type ResolverTile } from "./possession_actions";

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
  return { x: partial.x ?? 5, y: partial.y ?? 5, tileId: partial.tileId, state: partial.state ?? 0, metadata: partial.metadata ?? 0 };
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
    expectKind(resolvePossessedAction(v, tile({ tileId: CRATE_TILE }), NO_SERVICES), "open_container");
  });

  test("seed dispenser → open_container (passive route, not building)", () => {
    const v = makeVillager();
    expectKind(resolvePossessedAction(v, tile({ tileId: SEED_DISPENSER }), NO_SERVICES), "open_container");
  });

  test("active building (mill) → open_building", () => {
    const v = makeVillager();
    expectKind(resolvePossessedAction(v, tile({ tileId: MILL_TILE }), NO_SERVICES), "open_building");
  });

  test("shallow water → haul_water (when reserve below max)", () => {
    const v = makeVillager();
    v.waterReserve = 2;
    expectKind(resolvePossessedAction(v, tile({ tileId: SHALLOW_WATER }), NO_SERVICES), "haul_water");
  });

  test("shallow water with full reserve → none", () => {
    const v = makeVillager();
    v.waterReserve = 5;
    expectKind(resolvePossessedAction(v, tile({ tileId: SHALLOW_WATER }), NO_SERVICES), "none");
  });

  test("ripe wheat → harvest_crop", () => {
    const v = makeVillager();
    expectKind(resolvePossessedAction(v, tile({ tileId: WHEAT_BASE, state: 7 }), NO_SERVICES), "harvest_crop");
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
    expectKind(resolvePossessedAction(v, tile({ tileId: TILE_FARMLAND_TILLED, state: 0 }), NO_SERVICES), "plant_seed");
  });

  test("empty tilled tile + no seed → blocked: need_seed", () => {
    const v = makeVillager();
    const action = resolvePossessedAction(v, tile({ tileId: TILE_FARMLAND_TILLED, state: 0 }), NO_SERVICES);
    expect(action).toEqual({ kind: "blocked", reason: "need_seed" });
  });

  test("dry grass → till", () => {
    const v = makeVillager();
    expectKind(resolvePossessedAction(v, tile({ tileId: TILE_DRY_GRASS }), NO_SERVICES), "till");
  });

  test("wilted crop → none (not actionable)", () => {
    const v = makeVillager();
    expectKind(resolvePossessedAction(v, tile({ tileId: WHEAT_BASE, state: 255 }), NO_SERVICES), "none");
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
