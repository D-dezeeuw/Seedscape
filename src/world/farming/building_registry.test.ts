import { describe, expect, test } from "vitest";
import {
  BUILDING_RANGE_MAX,
  BUILDING_RANGE_MIN,
  buildingForTile,
  getQueuedJobs,
  isBuildingTile,
  setQueuedJobs,
} from "./building_registry";

describe("isBuildingTile", () => {
  test("range is 200..299 inclusive", () => {
    expect(isBuildingTile(BUILDING_RANGE_MIN)).toBe(true);
    expect(isBuildingTile(BUILDING_RANGE_MAX)).toBe(true);
    expect(isBuildingTile(199)).toBe(false);
    expect(isBuildingTile(300)).toBe(false);
  });
});

describe("buildingForTile", () => {
  test("mill base id is 200, bakery is 210", () => {
    expect(buildingForTile(200)?.name).toBe("mill");
    expect(buildingForTile(210)?.name).toBe("bakery");
  });

  test("returns null for unknown ids in range", () => {
    expect(buildingForTile(250)).toBe(null);
  });
});

describe("queue metadata encoding", () => {
  test("setQueuedJobs writes low 4 bits and preserves the rest", () => {
    expect(getQueuedJobs(setQueuedJobs(0, 5))).toBe(5);
    expect(getQueuedJobs(setQueuedJobs(0b11110000, 3))).toBe(3);
    // High bits preserved.
    expect(setQueuedJobs(0b11110000, 3) & 0b11110000).toBe(0b11110000);
  });

  test("queue clamps to [0, 15]", () => {
    expect(getQueuedJobs(setQueuedJobs(0, 99))).toBe(15);
    expect(getQueuedJobs(setQueuedJobs(0, -2))).toBe(0);
  });
});
