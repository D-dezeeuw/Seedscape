import { describe, expect, test } from "vitest";
import { isEntityWalkable } from "./walkability";

describe("isEntityWalkable", () => {
  test("water blocks", () => {
    expect(isEntityWalkable(0)).toBe(false); // shallow
    expect(isEntityWalkable(1)).toBe(false); // deep
    expect(isEntityWalkable(30)).toBe(false); // swamp
  });

  test("buildings block", () => {
    expect(isEntityWalkable(200)).toBe(false);
    expect(isEntityWalkable(210)).toBe(false);
    expect(isEntityWalkable(299)).toBe(false);
  });

  test("ground / soil / crops are walkable", () => {
    expect(isEntityWalkable(10)).toBe(true); // dry grass
    expect(isEntityWalkable(11)).toBe(true); // rich soil
    expect(isEntityWalkable(13)).toBe(true); // tilled
    expect(isEntityWalkable(31)).toBe(true); // mudflat (soft but passable)
    expect(isEntityWalkable(100)).toBe(true); // crop
    expect(isEntityWalkable(199)).toBe(true);
  });
});
