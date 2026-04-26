import { describe, expect, test } from "vitest";
import { ITEM_IDS } from "./items";
import {
  JOB_KIND_HARVEST_CROP,
  JOB_KIND_HAUL_WATER,
  JOB_KIND_WATER_CROP,
  JobBoard,
} from "./jobs";

import type { JobKind } from "./jobs";

const haulSpec = (x: number, y: number) => ({
  kind: JOB_KIND_HAUL_WATER as JobKind,
  source: { x, y },
  target: { x, y },
  priority: 1,
  payload: 0 as const,
});

const waterSpec = (x: number, y: number, priority = 2) => ({
  kind: JOB_KIND_WATER_CROP as JobKind,
  source: { x: 0, y: 0 }, // settler's reserve
  target: { x, y },
  priority,
  payload: 0 as const,
});

const harvestSpec = (x: number, y: number) => ({
  kind: JOB_KIND_HARVEST_CROP as JobKind,
  source: { x, y },
  target: { x: 0, y: 0 },
  priority: 1,
  payload: ITEM_IDS.WHEAT,
});

describe("JobBoard.enqueue / claim / complete", () => {
  test("enqueue assigns sequential ids", () => {
    const board = new JobBoard();
    const a = board.enqueue(haulSpec(0, 0));
    const b = board.enqueue(haulSpec(1, 0));
    expect(a).toBe(1);
    expect(b).toBe(2);
    expect(board.size()).toBe(2);
  });

  test("claim returns the closest matching unclaimed job", () => {
    const board = new JobBoard();
    board.enqueue(harvestSpec(10, 0));
    board.enqueue(harvestSpec(2, 0));
    board.enqueue(harvestSpec(20, 0));
    const claimed = board.claim(42, { kinds: [JOB_KIND_HARVEST_CROP], fromX: 0, fromY: 0 });
    expect(claimed?.source).toEqual({ x: 2, y: 0 });
    expect(claimed?.claimedBy).toBe(42);
  });

  test("priority overrides distance for claim selection", () => {
    const board = new JobBoard();
    board.enqueue(waterSpec(2, 0, 1)); // far in priority
    board.enqueue(waterSpec(20, 0, 5)); // farther but higher priority
    const claimed = board.claim(1, { fromX: 0, fromY: 0 });
    expect(claimed?.target).toEqual({ x: 20, y: 0 });
  });

  test("single-claim mutex: a second claimer cannot take a held job", () => {
    const board = new JobBoard();
    board.enqueue(haulSpec(5, 5));
    const a = board.claim(1, { fromX: 0, fromY: 0 });
    const b = board.claim(2, { fromX: 0, fromY: 0 });
    expect(a).not.toBeNull();
    expect(b).toBeNull(); // nothing else is unclaimed
  });

  test("kind filter excludes non-matching jobs", () => {
    const board = new JobBoard();
    board.enqueue(haulSpec(1, 0));
    board.enqueue(harvestSpec(2, 0));
    const onlyHarvest = board.claim(7, {
      kinds: [JOB_KIND_HARVEST_CROP],
      fromX: 0,
      fromY: 0,
    });
    expect(onlyHarvest?.kind).toBe(JOB_KIND_HARVEST_CROP);
  });

  test("complete removes the job", () => {
    const board = new JobBoard();
    const id = board.enqueue(haulSpec(0, 0));
    board.complete(id);
    expect(board.get(id)).toBeNull();
    expect(board.size()).toBe(0);
  });

  test("cancel removes the job (and a re-emit will create a fresh one)", () => {
    const board = new JobBoard();
    const id = board.enqueue(harvestSpec(3, 3));
    board.cancel(id, "stale source");
    expect(board.get(id)).toBeNull();
    const id2 = board.enqueue(harvestSpec(3, 3));
    expect(id2).not.toBe(id); // fresh id, not reuse
  });

  test("release frees a claim without removing the job", () => {
    const board = new JobBoard();
    const id = board.enqueue(haulSpec(2, 2));
    board.claim(1, { fromX: 0, fromY: 0 });
    board.release(id);
    const job = board.get(id);
    expect(job?.claimedBy).toBe(0);
    // Another settler can pick it up.
    const claimed = board.claim(2, { fromX: 0, fromY: 0 });
    expect(claimed?.id).toBe(id);
    expect(claimed?.claimedBy).toBe(2);
  });

  test("releaseAllByEntity drops every claim held by one settler", () => {
    const board = new JobBoard();
    board.enqueue(haulSpec(1, 0));
    board.enqueue(harvestSpec(2, 0));
    const a = board.claim(1, { fromX: 0, fromY: 0 });
    const b = board.claim(1, { fromX: 0, fromY: 0 });
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    board.releaseAllByEntity(1);
    expect(board.unclaimedCount()).toBe(2);
  });

  test("hasJobAt detects duplicate kind+source", () => {
    const board = new JobBoard();
    board.enqueue(harvestSpec(5, 5));
    expect(board.hasJobAt(JOB_KIND_HARVEST_CROP, 5, 5)).toBe(true);
    expect(board.hasJobAt(JOB_KIND_HARVEST_CROP, 6, 5)).toBe(false);
    expect(board.hasJobAt(JOB_KIND_HAUL_WATER, 5, 5)).toBe(false);
  });

  test("markProgress updates lastProgressTime", () => {
    const board = new JobBoard();
    const id = board.enqueue(haulSpec(0, 0));
    board.markProgress(id, 12.5);
    expect(board.get(id)?.lastProgressTime).toBe(12.5);
  });

  test("clear empties the board and resets ids", () => {
    const board = new JobBoard();
    board.enqueue(haulSpec(0, 0));
    board.clear();
    const id = board.enqueue(haulSpec(0, 0));
    expect(id).toBe(1);
  });

  test("unclaimedCount excludes claimed jobs", () => {
    const board = new JobBoard();
    board.enqueue(haulSpec(0, 0));
    board.enqueue(haulSpec(1, 1));
    expect(board.unclaimedCount()).toBe(2);
    board.claim(7, { fromX: 0, fromY: 0 });
    expect(board.unclaimedCount()).toBe(1);
  });
});
