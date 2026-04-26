import { describe, expect, test, vi } from "vitest";
import { Player } from "./player";

describe("Player coin/XP validation", () => {
  test("addCoins rejects negative", () => {
    const p = new Player();
    p.addCoins(-1); // currently a silent no-op (amount <= 0 short-circuits)
    expect(p.coins).toBe(0);
  });

  test("coins setter throws on negative", () => {
    const p = new Player();
    expect(() => {
      p.coins = -5;
    }).toThrow(/must be >= 0/);
    expect(p.coins).toBe(0);
  });

  test("coins setter accepts non-negative values", () => {
    const p = new Player();
    p.coins = 100;
    expect(p.coins).toBe(100);
    p.coins = 0;
    expect(p.coins).toBe(0);
  });

  test("xp setter throws on negative", () => {
    const p = new Player();
    p.addXp(50);
    expect(() => {
      p.xp = -1;
    }).toThrow(/must be >= 0/);
    expect(p.xp).toBe(50);
  });

  test("xp setter accepts non-negative values (debug panel reset path)", () => {
    const p = new Player();
    p.addXp(500);
    p.xp = 0;
    expect(p.xp).toBe(0);
    expect(p.level).toBe(1);
  });

  test("spendCoins throws on negative; refuses on insufficient", () => {
    const p = new Player();
    p.addCoins(10);
    expect(() => p.spendCoins(-1)).toThrow();
    expect(p.spendCoins(99)).toBe(false);
    expect(p.coins).toBe(10);
    expect(p.spendCoins(7)).toBe(true);
    expect(p.coins).toBe(3);
  });

  test("level recomputes on xp change; subscribers fire", () => {
    const p = new Player();
    const cb = vi.fn();
    p.subscribe(cb);
    p.addXp(1000);
    expect(p.level).toBeGreaterThan(1);
    expect(cb).toHaveBeenCalled();
  });
});
