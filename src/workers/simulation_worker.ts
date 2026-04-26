/// <reference lib="WebWorker" />
// Simulation worker. Receives chunk data + tick number, returns delta of
// changed tiles. Pure: same input → identical output bytes.

import { allocChunkData } from "../world/chunk";
import {
  allocSimScratch,
  type ProductionEvent,
  simulateChunkTick,
} from "../world/farming/sim_pipeline";

declare const self: DedicatedWorkerGlobalScope;

export interface SimRequest {
  taskId: number;
  chunkX: number;
  chunkY: number;
  tick: number;
  // Caller transfers buffers in; worker transfers them back to avoid copies.
  tileId: ArrayBuffer;
  state: ArrayBuffer;
  metadata: ArrayBuffer;
}

export type SimResponse =
  | {
      type: "result";
      taskId: number;
      chunkX: number;
      chunkY: number;
      // Delta arrays sliced to length=count. The pool transferred a *copy*
      // of the chunk in, so we don't need to round-trip the input buffers.
      count: number;
      indices: ArrayBuffer;
      deltaTileId: ArrayBuffer;
      deltaState: ArrayBuffer;
      deltaMetadata: ArrayBuffer;
      // Pre-tick values per entry. Main thread uses these as a guard so
      // player actions during in-flight time aren't overwritten — see
      // applySimDelta in sim_pipeline.ts.
      prevTileId: ArrayBuffer;
      prevState: ArrayBuffer;
      prevMetadata: ArrayBuffer;
      // Production events ride along via structured clone — small list, not
      // worth shaping into transferable buffers for Phase 4 throughput.
      productionEvents: ProductionEvent[];
    }
  | { type: "error"; taskId: number; error: string };

const scratch = allocSimScratch();

self.onmessage = (event: MessageEvent<SimRequest>): void => {
  const msg = event.data;
  try {
    const chunk = {
      tileId: new Uint16Array(msg.tileId),
      state: new Uint8Array(msg.state),
      metadata: new Uint8Array(msg.metadata),
    };

    const delta = simulateChunkTick(chunk, msg.tick, scratch);

    // Allocate fresh trimmed delta buffers — only `count` tiles changed.
    const indices = new Uint16Array(delta.count);
    const deltaTileId = new Uint16Array(delta.count);
    const deltaState = new Uint8Array(delta.count);
    const deltaMetadata = new Uint8Array(delta.count);
    const prevTileId = new Uint16Array(delta.count);
    const prevState = new Uint8Array(delta.count);
    const prevMetadata = new Uint8Array(delta.count);
    for (let n = 0; n < delta.count; n++) {
      indices[n] = delta.indices[n] as number;
      deltaTileId[n] = delta.tileId[n] as number;
      deltaState[n] = delta.state[n] as number;
      deltaMetadata[n] = delta.metadata[n] as number;
      prevTileId[n] = delta.prevTileId[n] as number;
      prevState[n] = delta.prevState[n] as number;
      prevMetadata[n] = delta.prevMetadata[n] as number;
    }

    const response: SimResponse = {
      type: "result",
      taskId: msg.taskId,
      chunkX: msg.chunkX,
      chunkY: msg.chunkY,
      count: delta.count,
      indices: indices.buffer as ArrayBuffer,
      deltaTileId: deltaTileId.buffer as ArrayBuffer,
      deltaState: deltaState.buffer as ArrayBuffer,
      deltaMetadata: deltaMetadata.buffer as ArrayBuffer,
      prevTileId: prevTileId.buffer as ArrayBuffer,
      prevState: prevState.buffer as ArrayBuffer,
      prevMetadata: prevMetadata.buffer as ArrayBuffer,
      productionEvents: delta.productionEvents,
    };

    self.postMessage(response, [
      response.indices,
      response.deltaTileId,
      response.deltaState,
      response.deltaMetadata,
      response.prevTileId,
      response.prevState,
      response.prevMetadata,
    ]);
  } catch (err) {
    const error: SimResponse = {
      type: "error",
      taskId: msg.taskId,
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(error);
  }
};

// Sanity probe at module load — surfaces import wiring mistakes early.
allocChunkData();
