import { describe, expect, test } from "vitest";
import { Chicken, Cow } from "../../state/entities/animal";
import { EntityManager } from "../../state/entities/entity_manager";
import { allocChunkData, CHUNK_FLAG_DIRTY_RENDER, type ChunkRecord, tileIndex } from "../chunk";
import { chunkKey } from "../coords";
import { TILE_CHICKEN_PEN, TILE_COW_PEN } from "./pen_registry";
import { findEmptyPen } from "./pen_spawn";

function makeChunk(cx: number, cy: number, fill = 10): [string, ChunkRecord] {
  const data = allocChunkData();
  for (let i = 0; i < data.tileId.length; i++) data.tileId[i] = fill;
  return [chunkKey(cx, cy), { data, flags: CHUNK_FLAG_DIRTY_RENDER }];
}

function fakeChunkManager(records: Array<[string, ChunkRecord]>) {
  const map = new Map(records);
  return {
    *allChunkRecords() {
      yield* map.entries();
    },
  } as unknown as Parameters<typeof findEmptyPen>[0];
}

describe("findEmptyPen", () => {
  test("returns null when no pen tiles of the requested species exist", () => {
    const [k, r] = makeChunk(0, 0);
    r.data.tileId[tileIndex(5, 5)] = TILE_COW_PEN;
    const cm = fakeChunkManager([[k, r]]);
    const em = new EntityManager();
    expect(findEmptyPen(cm, em, "chicken", 0, 0)).toBeNull();
  });

  test("finds the only chicken pen tile when none is occupied", () => {
    const [k, r] = makeChunk(0, 0);
    r.data.tileId[tileIndex(5, 5)] = TILE_CHICKEN_PEN;
    const cm = fakeChunkManager([[k, r]]);
    const em = new EntityManager();
    const hit = findEmptyPen(cm, em, "chicken", 0, 0);
    expect(hit).toEqual({ worldTileX: 5, worldTileY: 5 });
  });

  test("skips occupied pens (an Animal already lives there)", () => {
    const [k, r] = makeChunk(0, 0);
    r.data.tileId[tileIndex(5, 5)] = TILE_CHICKEN_PEN;
    r.data.tileId[tileIndex(7, 5)] = TILE_CHICKEN_PEN;
    const cm = fakeChunkManager([[k, r]]);
    const em = new EntityManager();
    em.add(
      new Chicken(
        em.allocateId(),
        { chunkX: 0, chunkY: 0, localX: 5.5, localY: 5.5 },
        { x: 5, y: 5 },
      ),
    );
    const hit = findEmptyPen(cm, em, "chicken", 0, 0);
    expect(hit).toEqual({ worldTileX: 7, worldTileY: 5 });
  });

  test("respects species — chicken search ignores cow pens and vice versa", () => {
    const [k, r] = makeChunk(0, 0);
    r.data.tileId[tileIndex(2, 2)] = TILE_COW_PEN;
    r.data.tileId[tileIndex(8, 8)] = TILE_CHICKEN_PEN;
    const cm = fakeChunkManager([[k, r]]);
    const em = new EntityManager();
    expect(findEmptyPen(cm, em, "cow", 0, 0)).toEqual({ worldTileX: 2, worldTileY: 2 });
    expect(findEmptyPen(cm, em, "chicken", 0, 0)).toEqual({ worldTileX: 8, worldTileY: 8 });
  });

  test("picks the nearest tile to the reference point", () => {
    const [k, r] = makeChunk(0, 0);
    r.data.tileId[tileIndex(2, 2)] = TILE_CHICKEN_PEN;
    r.data.tileId[tileIndex(20, 20)] = TILE_CHICKEN_PEN;
    const cm = fakeChunkManager([[k, r]]);
    const em = new EntityManager();
    expect(findEmptyPen(cm, em, "chicken", 18, 18)).toEqual({ worldTileX: 20, worldTileY: 20 });
    expect(findEmptyPen(cm, em, "chicken", 0, 0)).toEqual({ worldTileX: 2, worldTileY: 2 });
  });

  test("returns null when every pen of that species is occupied", () => {
    const [k, r] = makeChunk(0, 0);
    r.data.tileId[tileIndex(3, 3)] = TILE_COW_PEN;
    const cm = fakeChunkManager([[k, r]]);
    const em = new EntityManager();
    em.add(
      new Cow(em.allocateId(), { chunkX: 0, chunkY: 0, localX: 3.5, localY: 3.5 }, { x: 3, y: 3 }),
    );
    expect(findEmptyPen(cm, em, "cow", 0, 0)).toBeNull();
  });
});
