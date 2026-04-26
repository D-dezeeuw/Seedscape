/// <reference lib="WebWorker" />
// Pathfinding worker. Owns a mirror of every loaded chunk's walkability
// and serves A* requests from settlers (and any future AI consumer).
//
// Determinism: the worker is pure relative to (grid, request). It never
// reads clocks or RNG. Same gridVersion + same request → identical bytes.

import {
  findPath,
  type PathGrid,
  type PathRequest,
  PathfinderWorkspace,
} from "./pathfinding_core";

declare const self: DedicatedWorkerGlobalScope;

// ---- Message types ---------------------------------------------------

export interface InitGridRequest {
  type: "INIT_GRID";
  // Bulk install masks at boot (or after a save load). Replaces any prior grid.
  chunks: Array<{ key: string; mask: ArrayBuffer }>;
}

export interface UpdateChunkRequest {
  type: "UPDATE_CHUNK";
  key: string;
  mask: ArrayBuffer; // transferred
}

export interface InvalidateChunkRequest {
  type: "INVALIDATE";
  key: string;
}

export interface PathRequestMessage {
  type: "PATH_REQUEST";
  requestId: number;
  start: { x: number; y: number };
  goal: { x: number; y: number };
  maxNodes?: number;
}

export type PathfindingRequest =
  | InitGridRequest
  | UpdateChunkRequest
  | InvalidateChunkRequest
  | PathRequestMessage;

export interface PathResultMessage {
  type: "PATH_RESULT";
  requestId: number;
  found: boolean;
  // Always supplied (zero-length when !found) so the client can transfer
  // unconditionally without branching.
  waypoints: ArrayBuffer;
  gridVersion: number;
  expanded: number;
}

export interface GridAckMessage {
  type: "GRID_ACK";
  gridVersion: number;
}

export type PathfindingResponse = PathResultMessage | GridAckMessage;

// ---- State -----------------------------------------------------------

const grid: PathGrid = { masks: new Map() };
let gridVersion = 0;
const ws = new PathfinderWorkspace();

function bumpGrid(): void {
  gridVersion++;
}

function ack(): void {
  const msg: GridAckMessage = { type: "GRID_ACK", gridVersion };
  self.postMessage(msg);
}

self.onmessage = (event: MessageEvent<PathfindingRequest>): void => {
  const msg = event.data;

  switch (msg.type) {
    case "INIT_GRID": {
      grid.masks.clear();
      for (const c of msg.chunks) {
        grid.masks.set(c.key, new Uint8Array(c.mask));
      }
      bumpGrid();
      ack();
      return;
    }

    case "UPDATE_CHUNK": {
      grid.masks.set(msg.key, new Uint8Array(msg.mask));
      bumpGrid();
      ack();
      return;
    }

    case "INVALIDATE": {
      if (grid.masks.delete(msg.key)) bumpGrid();
      ack();
      return;
    }

    case "PATH_REQUEST": {
      const req: PathRequest = {
        start: msg.start,
        goal: msg.goal,
        ...(msg.maxNodes !== undefined ? { maxNodes: msg.maxNodes } : {}),
      };
      const result = findPath(grid, req, ws);
      const response: PathResultMessage = {
        type: "PATH_RESULT",
        requestId: msg.requestId,
        found: result.found,
        waypoints: result.waypoints.buffer as ArrayBuffer,
        gridVersion,
        expanded: result.expanded,
      };
      self.postMessage(response, [response.waypoints]);
      return;
    }
  }
};
