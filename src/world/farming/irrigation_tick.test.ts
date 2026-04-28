import { describe, expect, test } from "vitest";
import {
  allocChunkData,
  CHUNK_FLAG_DIRTY_RENDER,
  CHUNK_SIZE,
  type ChunkRecord,
  tileIndex,
} from "../chunk";
import { chunkKey } from "../coords";
import { irrigationTick } from "./irrigation_tick";
import { getWaterLevel, setWaterLevel } from "./tile_actions";

const TILE_FARMLAND_TILLED = 13;
const TILE_DRY_GRASS = 10;
const TILE_WELL = 230;
const TILE_SPRINKLER = 231;

function makeChunk(cx: number, cy: number, fill = TILE_DRY_GRASS): [string, ChunkRecord] {
  const data = allocChunkData();
  for (let i = 0; i < data.tileId.length; i++) data.tileId[i] = fill;
  return [chunkKey(cx, cy), { data, flags: CHUNK_FLAG_DIRTY_RENDER }];
}

function makeChunkManager(records: Array<[string, ChunkRecord]>) {
  const map = new Map(records);
  return {
    *allChunkRecords() {
      yield* map.entries();
    },
    peekChunk(cx: number, cy: number): ChunkRecord | null {
      return map.get(chunkKey(cx, cy)) ?? null;
    },
  } as unknown as Parameters<typeof irrigationTick>[0];
}

describe("irrigationTick", () => {
  test("Well waters 3x3 farmland on its period (10 ticks)", () => {
    const [k, r] = makeChunk(0, 0);
    r.data.tileId[tileIndex(5, 5)] = TILE_WELL;
    // Surround with tilled farmland.
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        r.data.tileId[tileIndex(5 + dx, 5 + dy)] = TILE_FARMLAND_TILLED;
      }
    }
    const cm = makeChunkManager([[k, r]]);

    // Off-period: nothing happens.
    irrigationTick(cm, 1);
    expect(getWaterLevel(r.data.metadata[tileIndex(4, 5)] ?? 0)).toBe(0);

    // On-period (tick 10): every neighbour fills to WATER_MAX (3).
    irrigationTick(cm, 10);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        expect(getWaterLevel(r.data.metadata[tileIndex(5 + dx, 5 + dy)] ?? 0)).toBe(3);
      }
    }
  });

  test("Sprinkler waters 5x5 on its period (5 ticks)", () => {
    const [k, r] = makeChunk(0, 0);
    r.data.tileId[tileIndex(10, 10)] = TILE_SPRINKLER;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (dx === 0 && dy === 0) continue;
        r.data.tileId[tileIndex(10 + dx, 10 + dy)] = TILE_FARMLAND_TILLED;
      }
    }
    const cm = makeChunkManager([[k, r]]);

    irrigationTick(cm, 5);
    // Inner ring (3×3) wet.
    expect(getWaterLevel(r.data.metadata[tileIndex(9, 10)] ?? 0)).toBe(3);
    // Outer ring (5×5) also wet — 2 tiles out from sprinkler.
    expect(getWaterLevel(r.data.metadata[tileIndex(8, 10)] ?? 0)).toBe(3);
    expect(getWaterLevel(r.data.metadata[tileIndex(12, 12)] ?? 0)).toBe(3);
    // 3 tiles out — outside the radius — stays dry.
    expect(getWaterLevel(r.data.metadata[tileIndex(13, 10)] ?? 0)).toBe(0);
  });

  test("does nothing when no irrigation buildings exist", () => {
    const [k, r] = makeChunk(0, 0);
    r.data.tileId[tileIndex(5, 5)] = TILE_FARMLAND_TILLED;
    const cm = makeChunkManager([[k, r]]);
    irrigationTick(cm, 10);
    expect(getWaterLevel(r.data.metadata[tileIndex(5, 5)] ?? 0)).toBe(0);
  });

  test("skips already-saturated tiles (no useless dirty marks)", () => {
    const [k, r] = makeChunk(0, 0);
    r.data.tileId[tileIndex(5, 5)] = TILE_WELL;
    r.data.tileId[tileIndex(4, 5)] = TILE_FARMLAND_TILLED;
    r.data.metadata[tileIndex(4, 5)] = setWaterLevel(0, 3); // already max
    r.flags = 0;
    const cm = makeChunkManager([[k, r]]);
    irrigationTick(cm, 10);
    // No dirty flags set because nothing changed for that tile.
    // (Other neighbours that did change would still flag the chunk; we
    // only have one farmable tile here so flags should remain 0.)
    expect(r.flags).toBe(0);
  });

  test("skips non-farmable tiles (grass, rocks)", () => {
    const [k, r] = makeChunk(0, 0);
    r.data.tileId[tileIndex(5, 5)] = TILE_WELL;
    // Neighbour is plain grass — not farmland, no crop. Should not be wet.
    const cm = makeChunkManager([[k, r]]);
    irrigationTick(cm, 10);
    expect(getWaterLevel(r.data.metadata[tileIndex(4, 5)] ?? 0)).toBe(0);
  });

  test("crosses chunk boundaries", () => {
    const [k0, r0] = makeChunk(0, 0);
    const [k1, r1] = makeChunk(1, 0);
    // Well at the right edge of chunk (0,0).
    r0.data.tileId[tileIndex(CHUNK_SIZE - 1, 5)] = TILE_WELL;
    // Farmland at the left edge of chunk (1,0) — one tile right of the well.
    r1.data.tileId[tileIndex(0, 5)] = TILE_FARMLAND_TILLED;
    const cm = makeChunkManager([
      [k0, r0],
      [k1, r1],
    ]);
    irrigationTick(cm, 10);
    expect(getWaterLevel(r1.data.metadata[tileIndex(0, 5)] ?? 0)).toBe(3);
  });
});
