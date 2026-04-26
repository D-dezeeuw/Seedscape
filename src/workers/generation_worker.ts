/// <reference lib="WebWorker" />
// Generation worker. Pure: same input → identical output bytes. Holds noise
// instances per worldSeed so simplex permutation tables are built once.

import { allocChunkData, type ChunkData, TILES_PER_CHUNK } from "../world/chunk";
import { createWorldNoise, generateChunk, type WorldNoise } from "../world/generation";

declare const self: DedicatedWorkerGlobalScope;

export type GenerationRequest =
  | { type: "init"; worldSeed: number }
  | { type: "generate"; taskId: number; chunkX: number; chunkY: number };

export type GenerationResponse =
  | { type: "ready" }
  | {
      type: "result";
      taskId: number;
      chunkX: number;
      chunkY: number;
      tileId: ArrayBuffer;
      state: ArrayBuffer;
      metadata: ArrayBuffer;
    }
  | { type: "error"; taskId: number; error: string };

let noise: WorldNoise | null = null;
// Scratch ChunkData. Generation writes into it in place; we transfer the
// underlying buffers to the main thread (zero-copy) and allocate a fresh
// ChunkData for the next task. One small allocation per generated chunk —
// not per-frame, not on the render path, so the cost is amortized across
// streaming. A ring of pre-allocated ChunkData would eliminate it; not
// doing that yet because chunk gen isn't the hot path.
let scratch: ChunkData = allocChunkData();

self.onmessage = (event: MessageEvent<GenerationRequest>): void => {
  const msg = event.data;
  if (msg.type === "init") {
    noise = createWorldNoise(msg.worldSeed);
    const ready: GenerationResponse = { type: "ready" };
    self.postMessage(ready);
    return;
  }

  if (msg.type === "generate") {
    if (!noise) {
      const error: GenerationResponse = {
        type: "error",
        taskId: msg.taskId,
        error: "generation worker received generate before init",
      };
      self.postMessage(error);
      return;
    }
    try {
      generateChunk(noise, msg.chunkX, msg.chunkY, scratch);
      const filled = scratch;
      // Hand off the underlying buffers and allocate fresh scratch for the
      // next task. Transferables zero-copy into the main thread.
      // The buffer types narrow to ArrayBufferLike under newer lib.dom; we
      // always allocate fresh Typed Arrays so casting to ArrayBuffer is safe.
      const tileBuf = filled.tileId.buffer as ArrayBuffer;
      const stateBuf = filled.state.buffer as ArrayBuffer;
      const metaBuf = filled.metadata.buffer as ArrayBuffer;
      const response: GenerationResponse = {
        type: "result",
        taskId: msg.taskId,
        chunkX: msg.chunkX,
        chunkY: msg.chunkY,
        tileId: tileBuf,
        state: stateBuf,
        metadata: metaBuf,
      };
      scratch = allocChunkData();
      self.postMessage(response, [tileBuf, stateBuf, metaBuf]);
    } catch (err) {
      const error: GenerationResponse = {
        type: "error",
        taskId: msg.taskId,
        error: err instanceof Error ? err.message : String(err),
      };
      self.postMessage(error);
    }
  }
};

// Sanity check at module load: tile counts agree across worker and main.
// (No-op outside of dev; surfaces obvious mistakes early.)
if (TILES_PER_CHUNK !== 1024) {
  throw new Error(`generation worker: unexpected TILES_PER_CHUNK=${TILES_PER_CHUNK}`);
}
