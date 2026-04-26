import { beforeEach, describe, expect, test } from "vitest";
import { CHUNK_SIZE, TILES_PER_CHUNK } from "../world/chunk";
import { chunkKey } from "../world/coords";
import {
  findPath,
  isWalkable,
  MAX_DIM,
  PathfinderWorkspace,
  type PathGrid,
} from "./pathfinding_core";

function emptyMask(): Uint8Array {
  return new Uint8Array(TILES_PER_CHUNK).fill(1); // all walkable
}

function blockedMask(): Uint8Array {
  return new Uint8Array(TILES_PER_CHUNK); // all 0 = blocked
}

// Build a grid covering chunks [-1..1, -1..1] around origin so paths near (0,0)
// have headroom in every direction.
function gridAroundOrigin(): PathGrid {
  const masks = new Map<string, Uint8Array>();
  for (let cy = -1; cy <= 1; cy++) {
    for (let cx = -1; cx <= 1; cx++) {
      masks.set(chunkKey(cx, cy), emptyMask());
    }
  }
  return { masks };
}

// Set walkability at world tile (wx, wy) within an existing grid.
function setTile(grid: PathGrid, wx: number, wy: number, walkable: boolean): void {
  const cx = Math.floor(wx / CHUNK_SIZE);
  const cy = Math.floor(wy / CHUNK_SIZE);
  let mask = grid.masks.get(chunkKey(cx, cy));
  if (!mask) {
    mask = emptyMask();
    grid.masks.set(chunkKey(cx, cy), mask);
  }
  const lx = wx - cx * CHUNK_SIZE;
  const ly = wy - cy * CHUNK_SIZE;
  mask[ly * CHUNK_SIZE + lx] = walkable ? 1 : 0;
}

describe("isWalkable", () => {
  test("missing chunk reads as blocked", () => {
    const grid: PathGrid = { masks: new Map() };
    expect(isWalkable(grid, 0, 0)).toBe(false);
    expect(isWalkable(grid, -1, -1)).toBe(false);
  });

  test("loaded chunk reflects mask", () => {
    const grid: PathGrid = { masks: new Map([[chunkKey(0, 0), blockedMask()]]) };
    expect(isWalkable(grid, 0, 0)).toBe(false);
    setTile(grid, 5, 5, true);
    expect(isWalkable(grid, 5, 5)).toBe(true);
  });

  test("crosses negative chunk boundary", () => {
    const grid = gridAroundOrigin();
    expect(isWalkable(grid, -1, -1)).toBe(true);
    setTile(grid, -1, -1, false);
    expect(isWalkable(grid, -1, -1)).toBe(false);
    expect(isWalkable(grid, 0, 0)).toBe(true);
  });
});

describe("findPath", () => {
  let ws: PathfinderWorkspace;
  beforeEach(() => {
    ws = new PathfinderWorkspace();
  });

  test("trivial: start === goal returns single waypoint", () => {
    const grid = gridAroundOrigin();
    const r = findPath(grid, { start: { x: 5, y: 5 }, goal: { x: 5, y: 5 } }, ws);
    expect(r.found).toBe(true);
    expect(Array.from(r.waypoints)).toEqual([5, 5]);
  });

  test("straight line: 5 tiles east", () => {
    const grid = gridAroundOrigin();
    const r = findPath(grid, { start: { x: 0, y: 0 }, goal: { x: 5, y: 0 } }, ws);
    expect(r.found).toBe(true);
    // 6 waypoints total (start through goal inclusive).
    expect(r.waypoints.length).toBe(12);
    expect(Array.from(r.waypoints.slice(0, 2))).toEqual([0, 0]);
    expect(Array.from(r.waypoints.slice(-2))).toEqual([5, 0]);
  });

  test("detour around a wall", () => {
    const grid = gridAroundOrigin();
    // Wall at x=2, y in [-1..1] forces a detour.
    setTile(grid, 2, -1, false);
    setTile(grid, 2, 0, false);
    setTile(grid, 2, 1, false);
    const r = findPath(grid, { start: { x: 0, y: 0 }, goal: { x: 4, y: 0 } }, ws);
    expect(r.found).toBe(true);
    // Path must avoid (2, -1..1).
    for (let i = 0; i < r.waypoints.length; i += 2) {
      const x = r.waypoints[i] as number;
      const y = r.waypoints[i + 1] as number;
      expect(!(x === 2 && (y === -1 || y === 0 || y === 1))).toBe(true);
    }
    // Last waypoint is the goal.
    expect(r.waypoints[r.waypoints.length - 2]).toBe(4);
    expect(r.waypoints[r.waypoints.length - 1]).toBe(0);
  });

  test("unreachable: goal walled off completely returns no path", () => {
    const grid = gridAroundOrigin();
    // Wall surrounding (3,0).
    setTile(grid, 2, 0, false);
    setTile(grid, 4, 0, false);
    setTile(grid, 3, -1, false);
    setTile(grid, 3, 1, false);
    const r = findPath(grid, { start: { x: 0, y: 0 }, goal: { x: 3, y: 0 } }, ws);
    expect(r.found).toBe(false);
    expect(r.waypoints.length).toBe(0);
  });

  test("unreachable when start tile is blocked", () => {
    const grid = gridAroundOrigin();
    setTile(grid, 0, 0, false);
    const r = findPath(grid, { start: { x: 0, y: 0 }, goal: { x: 5, y: 0 } }, ws);
    expect(r.found).toBe(false);
  });

  test("unreachable when goal tile is blocked", () => {
    const grid = gridAroundOrigin();
    setTile(grid, 5, 0, false);
    const r = findPath(grid, { start: { x: 0, y: 0 }, goal: { x: 5, y: 0 } }, ws);
    expect(r.found).toBe(false);
  });

  test("respects maxNodes budget (returns no-path when exceeded)", () => {
    const grid = gridAroundOrigin();
    // Tiny budget that can't reach a 10-tile-away goal.
    const r = findPath(grid, { start: { x: 0, y: 0 }, goal: { x: 10, y: 10 }, maxNodes: 3 }, ws);
    expect(r.found).toBe(false);
  });

  test("rejects requests whose bbox exceeds MAX_DIM", () => {
    const grid = gridAroundOrigin();
    const r = findPath(grid, { start: { x: 0, y: 0 }, goal: { x: MAX_DIM + 10, y: 0 } }, ws);
    expect(r.found).toBe(false);
  });

  test("deterministic: same input → identical waypoints across runs", () => {
    const grid = gridAroundOrigin();
    setTile(grid, 2, 0, false);
    setTile(grid, 2, 1, false);
    const wsA = new PathfinderWorkspace();
    const wsB = new PathfinderWorkspace();
    const a = findPath(grid, { start: { x: 0, y: 0 }, goal: { x: 5, y: 3 } }, wsA);
    const b = findPath(grid, { start: { x: 0, y: 0 }, goal: { x: 5, y: 3 } }, wsB);
    expect(a.found).toBe(true);
    expect(b.found).toBe(true);
    expect(Array.from(a.waypoints)).toEqual(Array.from(b.waypoints));
  });

  test("workspace reuse across many requests stays correct", () => {
    const grid = gridAroundOrigin();
    for (let i = 0; i < 200; i++) {
      const r = findPath(grid, { start: { x: 0, y: 0 }, goal: { x: 5, y: i % 5 } }, ws);
      expect(r.found).toBe(true);
    }
  });

  test("crosses chunk boundaries", () => {
    const grid = gridAroundOrigin();
    // Path from chunk (0,0) into chunk (-1,0).
    const r = findPath(grid, { start: { x: 0, y: 0 }, goal: { x: -5, y: 0 } }, ws);
    expect(r.found).toBe(true);
    expect(r.waypoints[r.waypoints.length - 2]).toBe(-5);
  });

  test("treats unloaded chunk as blocked", () => {
    // Only chunk (0,0) loaded; goal at (35, 0) is in chunk (1, 0) which is missing.
    const grid: PathGrid = { masks: new Map([[chunkKey(0, 0), emptyMask()]]) };
    const r = findPath(grid, { start: { x: 0, y: 0 }, goal: { x: 35, y: 0 } }, ws);
    expect(r.found).toBe(false);
  });
});
