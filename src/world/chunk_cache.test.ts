import { describe, expect, test } from "vitest";
import { ChunkCache } from "./chunk_cache";

describe("ChunkCache", () => {
  test("rejects non-positive capacity", () => {
    expect(() => new ChunkCache<number>({ capacity: 0 })).toThrow();
    expect(() => new ChunkCache<number>({ capacity: -1 })).toThrow();
  });

  test("stores up to capacity entries", () => {
    const cache = new ChunkCache<number>({ capacity: 3 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.size).toBe(3);
    expect(cache.get("a")).toBe(1);
  });

  test("evicts least-recently-used on overflow", () => {
    const evicted: Array<[string, number]> = [];
    const cache = new ChunkCache<number>({
      capacity: 2,
      onEvict: (k, v) => evicted.push([k, v]),
    });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.has("a")).toBe(false);
    expect(cache.has("b")).toBe(true);
    expect(cache.has("c")).toBe(true);
    expect(evicted).toEqual([["a", 1]]);
  });

  test("peek() returns the value without promoting (eviction order unchanged)", () => {
    const evicted: string[] = [];
    const cache = new ChunkCache<number>({
      capacity: 2,
      onEvict: (k) => evicted.push(k),
    });
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.peek("a")).toBe(1);
    // peek did NOT promote a — so adding c must evict a (oldest), not b.
    cache.set("c", 3);
    expect(cache.has("a")).toBe(false);
    expect(cache.has("b")).toBe(true);
    expect(evicted).toEqual(["a"]);
  });

  test("peek() returns undefined for missing keys", () => {
    const cache = new ChunkCache<number>({ capacity: 2 });
    cache.set("a", 1);
    expect(cache.peek("missing")).toBeUndefined();
  });

  test("get() promotes to most-recently-used", () => {
    const evicted: string[] = [];
    const cache = new ChunkCache<number>({
      capacity: 2,
      onEvict: (k) => evicted.push(k),
    });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a"); // promote a
    cache.set("c", 3); // should evict b, not a
    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
    expect(evicted).toEqual(["b"]);
  });

  test("set() of existing key promotes and replaces value", () => {
    const cache = new ChunkCache<number>({ capacity: 2 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("a", 99); // replace + promote
    cache.set("c", 3); // should evict b
    expect(cache.get("a")).toBe(99);
    expect(cache.has("b")).toBe(false);
    expect(cache.has("c")).toBe(true);
  });

  test("protected keys survive eviction even when oldest", () => {
    const evicted: string[] = [];
    const cache = new ChunkCache<number>({
      capacity: 2,
      onEvict: (k) => evicted.push(k),
    });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3, new Set(["a"])); // a is oldest but protected
    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
    expect(cache.has("c")).toBe(true);
    expect(evicted).toEqual(["b"]);
  });

  test("delete() fires onEvict and returns true on hit", () => {
    const evicted: string[] = [];
    const cache = new ChunkCache<number>({
      capacity: 4,
      onEvict: (k) => evicted.push(k),
    });
    cache.set("a", 1);
    expect(cache.delete("a")).toBe(true);
    expect(cache.delete("a")).toBe(false);
    expect(evicted).toEqual(["a"]);
  });

  test("clear() fires onEvict for every entry and empties the cache", () => {
    const evicted: string[] = [];
    const cache = new ChunkCache<number>({
      capacity: 4,
      onEvict: (k) => evicted.push(k),
    });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(evicted.sort()).toEqual(["a", "b"]);
  });
});
