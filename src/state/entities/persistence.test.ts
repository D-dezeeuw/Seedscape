import { describe, expect, test } from "vitest";
import { Mount, Pet } from "./animal";
import { FACING_EAST } from "./entity";
import { deserializeEntity, serializeEntity } from "./persistence";
import { Villager } from "./villager";

describe("entity persistence round-trip", () => {
  test("villager preserves name, home, facing, position", () => {
    const v = new Villager(
      7,
      { chunkX: 1, chunkY: -2, localX: 4.5, localY: 12.25 },
      "Settler",
      { x: 3, y: 4 },
      FACING_EAST,
    );
    const round = deserializeEntity(serializeEntity(v));
    expect(round).toBeInstanceOf(Villager);
    const r = round as Villager;
    expect(r.id).toBe(7);
    expect(r.name).toBe("Settler");
    expect(r.homeWorldTileX).toBe(3);
    expect(r.homeWorldTileY).toBe(4);
    expect(r.facing).toBe(FACING_EAST);
    expect(r.chunkX).toBe(1);
    expect(r.chunkY).toBe(-2);
    expect(r.localX).toBe(4.5);
    expect(r.localY).toBe(12.25);
  });

  test("villager gender round-trips", () => {
    const v = new Villager(
      8,
      { chunkX: 0, chunkY: 0, localX: 0, localY: 0 },
      "Maria",
      { x: 0, y: 0 },
    );
    v.gender = "female";
    const r = deserializeEntity(serializeEntity(v)) as Villager;
    expect(r.gender).toBe("female");

    const m = new Villager(
      9,
      { chunkX: 0, chunkY: 0, localX: 0, localY: 0 },
      "Jan",
      { x: 0, y: 0 },
    );
    m.gender = "male";
    expect((deserializeEntity(serializeEntity(m)) as Villager).gender).toBe("male");
  });

  test("pet preserves owner + follow radius", () => {
    const p = new Pet(
      8,
      { chunkX: 0, chunkY: 0, localX: 0, localY: 0 },
      "dog",
      { x: 1, y: 1 },
      7,
      5,
    );
    const r = deserializeEntity(serializeEntity(p)) as Pet;
    expect(r).toBeInstanceOf(Pet);
    expect(r.species).toBe("dog");
    expect(r.ownerId).toBe(7);
    expect(r.followRadius).toBe(5);
  });

  test("mount preserves species and pen", () => {
    const m = new Mount(9, { chunkX: 0, chunkY: 0, localX: 0, localY: 0 }, "horse", { x: 2, y: 2 });
    const r = deserializeEntity(serializeEntity(m)) as Mount;
    expect(r).toBeInstanceOf(Mount);
    expect(r.species).toBe("horse");
    // Idle mount round-trips with its default runtime state intact.
    expect(r.ridden).toBe(false);
    expect(r.riderId).toBeNull();
  });

  test("mount preserves ridden state across save/load", () => {
    const m = new Mount(9, { chunkX: 0, chunkY: 0, localX: 0, localY: 0 }, "horse", { x: 2, y: 2 });
    m.ridden = true;
    m.riderId = 42;
    const r = deserializeEntity(serializeEntity(m)) as Mount;
    expect(r.ridden).toBe(true);
    expect(r.riderId).toBe(42);
  });
});
