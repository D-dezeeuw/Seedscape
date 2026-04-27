// Main-thread auto-queue pass. Phase 8 introduces per-building input
// buffers fed by settlers (FEED_BUILDING jobs); the sim worker still
// only knows about the metadata.queued counter. This tick bridges them:
// for every loaded building tile, drain `cycleInput` worth of input
// from the buffer into the queue counter.
//
// The sim then runs cycles exactly as before — no worker change. Output
// from finished cycles is redirected to the building's output buffer
// in main.ts (instead of the player's inventory) so settlers have
// something to haul (HAUL_OUTPUT).
//
// Skips passive containers (crate, dispenser) since they have no
// cycleTime; skips buildings whose def is unknown (defensive against
// future tile ids).

import {
  CHUNK_FLAG_DIRTY_RENDER,
  CHUNK_FLAG_DIRTY_SIMULATION,
  CHUNK_SIZE,
  type ChunkRecord,
  tileIndex,
} from "../chunk";
import type { BuildingBufferStore } from "./building_buffer";
import { INPUT_BUFFER_MULTIPLIER, OUTPUT_BUFFER_MULTIPLIER } from "./building_buffer";
import { buildingForTile, getQueuedJobs, setQueuedJobs } from "./building_registry";

// Mirror of QUEUE_BITS_MASK so we can clamp without re-importing the
// internal constant. Keep in sync if the metadata layout ever widens.
const QUEUE_MAX = 15;

export interface ChunkSource {
  allChunkRecords(): IterableIterator<[string, ChunkRecord]>;
}

// Run one auto-queue pass. Returns the number of cycles enqueued —
// useful for tests; production callers can ignore. Cheap when no
// buffers have content (early-exits on totalInputAt === 0).
export function autoQueueFromBuffers(chunks: ChunkSource, buffers: BuildingBufferStore): number {
  let enqueued = 0;
  for (const [key, record] of chunks.allChunkRecords()) {
    const [cxStr, cyStr] = key.split(",");
    const cx = Number(cxStr);
    const cy = Number(cyStr);
    const baseX = cx * CHUNK_SIZE;
    const baseY = cy * CHUNK_SIZE;
    let chunkChanged = false;
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const idx = tileIndex(lx, ly);
        const tid = record.data.tileId[idx] ?? 0;
        const def = buildingForTile(tid);
        if (!def || def.passive) continue;
        if (def.cycleTime <= 0) continue;

        const wx = baseX + lx;
        const wy = baseY + ly;
        // Cheap precheck: the cap math runs on every building each
        // tick, so bail before reading the inner Map when the buffer
        // is empty.
        if (buffers.totalInputAt(wx, wy) < def.inputQuantity) continue;

        const queued = getQueuedJobs(record.data.metadata[idx] ?? 0);
        if (queued >= QUEUE_MAX) continue;

        // Try to consume one full cycle's worth. If the buffer holds
        // partial — say 2 wheat when the recipe needs 3 — we leave it
        // and wait for a settler to top it off.
        const have = buffers.inputAt(wx, wy, def.inputItem);
        if (have < def.inputQuantity) continue;

        // The auto-queue runs every sim tick; without a per-building
        // upper limit we'd rapidly fill `queued` while the buffer has
        // many cycles' worth, which blocks settlers from delivering more
        // until those cycles drain. Cap enqueueable cycles at the buffer
        // multiplier so back-pressure is preserved.
        if (queued >= INPUT_BUFFER_MULTIPLIER) continue;

        const taken = buffers.consumeInput(wx, wy, def.inputItem, def.inputQuantity);
        if (taken !== def.inputQuantity) {
          // Race-defensive: if consumeInput returned less than expected
          // (e.g. because another path drained between the inputAt
          // check and the consume), put it back rather than half-feed.
          if (taken > 0)
            buffers.addInput(
              wx,
              wy,
              def.inputItem,
              taken,
              def.inputQuantity * INPUT_BUFFER_MULTIPLIER,
            );
          continue;
        }
        record.data.metadata[idx] = setQueuedJobs(record.data.metadata[idx] ?? 0, queued + 1);
        chunkChanged = true;
        enqueued++;
      }
    }
    if (chunkChanged) {
      record.flags |= CHUNK_FLAG_DIRTY_RENDER | CHUNK_FLAG_DIRTY_SIMULATION;
    }
  }
  return enqueued;
}

// Compute the input-buffer cap a building tile uses when callers add
// to its buffer (settlers feeding, player manual deposit). Centralised
// so the multiplier choice stays in one place.
export function buildingInputCap(inputQuantity: number): number {
  return Math.max(1, inputQuantity) * INPUT_BUFFER_MULTIPLIER;
}

// Compute the output-buffer cap a building tile uses (sim handler,
// player manual withdraw, HAUL_OUTPUT settler).
export function buildingOutputCap(outputQuantity: number): number {
  return Math.max(1, outputQuantity) * OUTPUT_BUFFER_MULTIPLIER;
}
