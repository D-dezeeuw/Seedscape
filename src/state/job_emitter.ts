// Job emitter — periodic scan that converts world state into board entries.
//
// Runs on a fixed sim-tick cadence (default 30 ticks ≈ 30 seconds at 1 TPS).
// For each loaded chunk it walks the tile arrays once and emits:
//   - HARVEST_CROP for any tile at CROP_STAGE_HARVESTABLE
//   - WATER_CROP for any growing crop with water below WATER_THRESHOLD
//
// HAUL_WATER is NOT emitted here — it's spawned lazily by the settler when
// it claims a WATER_CROP and finds its reserve empty. The emitter has no
// idea which settlers are dry, so emitting blindly would pile up unclaimed
// jobs at every water tile.
//
// Dedup: every emit checks board.hasJobAt(kind, sx, sy) so a tile that was
// emitted last scan and is still pending doesn't get a duplicate. The
// constant-time scan over <300 jobs is well below the per-chunk tile loop.

import { CHUNK_SIZE, type ChunkRecord, tileIndex } from "../world/chunk";
import { isSeedItem } from "../world/farming/container_registry";
import type { CrateStore } from "../world/farming/crate";
import {
  CROP_STAGE_HARVESTABLE,
  CROP_STATE_WILTED,
  cropForTile,
} from "../world/farming/crop_registry";
import { getWaterLevel } from "../world/farming/tile_actions";
import { ITEM_IDS, type ItemId } from "./items";
import {
  JOB_KIND_HARVEST_CROP,
  JOB_KIND_PLANT_SEED,
  JOB_KIND_WATER_CROP,
  type JobBoard,
} from "./jobs";

const TILE_FARMLAND_TILLED = 13;

// Crops with water at or below this level are considered thirsty enough
// that a WATER_CROP job is worth emitting. WATER_DECAY_INTERVAL drains by 1
// every 4 ticks; threshold of 1 (drier than 1, i.e. 0) keeps the queue from
// thrashing while crops are still growing fine.
export const WATER_THIRSTY_THRESHOLD = 1;

// Default scan period in sim ticks. 30 ≈ 30s; long enough that a single
// scan + dedup pass amortizes well; short enough that a freshly ripe crop
// gets queued before the player would notice the lag.
export const DEFAULT_EMITTER_PERIOD_TICKS = 30;

// Cap on total board entries the emitter will create per scan. Without it,
// a sudden ripening of every crop in 50 chunks would flood the board with
// thousands of jobs in one call. Settlers can't claim that fast and the
// board scan grows linearly. 256 is comfortable headroom for 150 settlers.
export const MAX_JOBS_PER_SCAN = 256;

export interface ChunkSource {
  // Every record-yielding chunk source (the live ChunkManager passes its
  // allChunkRecords iterator through unchanged). Tests can inject a
  // hand-built iterable.
  allChunkRecords(): IterableIterator<[string, ChunkRecord]>;
}

function parseChunkKey(key: string): [number, number] {
  const comma = key.indexOf(",");
  return [Number(key.slice(0, comma)), Number(key.slice(comma + 1))];
}

export class JobEmitter {
  private readonly board: JobBoard;
  private readonly chunks: ChunkSource;
  // Optional CrateStore reference. When provided, the emitter only
  // spawns PLANT_SEED jobs while at least one container holds a seed —
  // there's no point queueing planting work the settlers can't fulfil.
  // Tests that don't care about planting can omit this.
  private readonly crates: CrateStore | undefined;
  private readonly period: number;
  private lastScanTick = -Infinity;

  constructor(opts: {
    board: JobBoard;
    chunks: ChunkSource;
    crates?: CrateStore;
    periodTicks?: number;
  }) {
    this.board = opts.board;
    this.chunks = opts.chunks;
    this.crates = opts.crates;
    this.period = opts.periodTicks ?? DEFAULT_EMITTER_PERIOD_TICKS;
  }

  // Returns the number of jobs added this scan (or 0 if it wasn't time yet).
  // Caller passes the current sim tick; the emitter decides if the cadence
  // has elapsed.
  tick(currentTick: number): number {
    if (currentTick - this.lastScanTick < this.period) return 0;
    this.lastScanTick = currentTick;
    return this.scanAll();
  }

  // Force a scan immediately. Used by tests + by the boot path so the first
  // job set is on the board the moment a save loads, not 30 ticks later.
  scanAll(): number {
    let emitted = 0;
    // Pre-compute "is any seed available?" once per scan; it gates every
    // PLANT_SEED emission. Without this each empty tilled tile would walk
    // the crate store. The result is allowed to go stale within a scan —
    // by the next scan the answer will be re-computed.
    const seedsAvailable = this.crates ? hasAnySeed(this.crates) : false;

    for (const [key, record] of this.chunks.allChunkRecords()) {
      const [cx, cy] = parseChunkKey(key);
      const baseX = cx * CHUNK_SIZE;
      const baseY = cy * CHUNK_SIZE;
      const data = record.data;
      for (let ly = 0; ly < CHUNK_SIZE; ly++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          if (emitted >= MAX_JOBS_PER_SCAN) return emitted;
          const i = tileIndex(lx, ly);
          const tileId = data.tileId[i] ?? 0;
          const wx = baseX + lx;
          const wy = baseY + ly;

          // Empty tilled farmland: candidate for PLANT_SEED.
          if (tileId === TILE_FARMLAND_TILLED && (data.state[i] ?? 0) === 0) {
            if (!seedsAvailable) continue;
            if (this.board.hasJobAt(JOB_KIND_PLANT_SEED, wx, wy)) continue;
            this.board.enqueue({
              kind: JOB_KIND_PLANT_SEED,
              source: { x: wx, y: wy },
              target: { x: wx, y: wy },
              priority: 1,
              // Specific seed item is resolved at claim time — settlers
              // grab whatever's currently in the nearest container.
              payload: 0,
            });
            emitted++;
            continue;
          }

          const crop = cropForTile(tileId);
          if (!crop) continue;
          const state = data.state[i] ?? 0;
          if (state === CROP_STATE_WILTED) continue;

          if (state >= CROP_STAGE_HARVESTABLE) {
            if (!this.board.hasJobAt(JOB_KIND_HARVEST_CROP, wx, wy)) {
              this.board.enqueue({
                kind: JOB_KIND_HARVEST_CROP,
                source: { x: wx, y: wy },
                target: { x: wx, y: wy }, // resolved to crate at claim time
                priority: 1,
                payload: crop.produceItem,
              });
              emitted++;
            }
            continue;
          }

          const water = getWaterLevel(data.metadata[i] ?? 0);
          if (water <= WATER_THIRSTY_THRESHOLD) {
            if (!this.board.hasJobAt(JOB_KIND_WATER_CROP, wx, wy)) {
              this.board.enqueue({
                kind: JOB_KIND_WATER_CROP,
                source: { x: wx, y: wy },
                target: { x: wx, y: wy },
                // Drier = higher priority. water=0 → priority 3, water=1 → 2.
                priority: 3 - water,
                payload: 0,
              });
              emitted++;
            }
          }
        }
      }
    }
    return emitted;
  }
}

// True if any container has at least one seed-range item. Cheap: walks
// CrateStore.crates() and probes each entry, stopping at the first hit.
function hasAnySeed(crates: CrateStore): boolean {
  // CrateStore exposes per-tile totals but not per-item iteration. Use
  // the same probe set as container_window — every seed id we currently
  // ship. When the seed range grows, swap for an itemsAt() iterator.
  const seedProbe: ItemId[] = [ITEM_IDS.WHEAT_SEED, ITEM_IDS.CARROT_SEED, ITEM_IDS.CORN_SEED];
  for (const c of crates.crates()) {
    for (const id of seedProbe) {
      if (!isSeedItem(id)) continue;
      if (crates.countAt(c.x, c.y, id) > 0) return true;
    }
  }
  return false;
}
