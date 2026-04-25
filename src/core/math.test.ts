import { describe, expect, test } from "vitest";
import { mat4Identity, mat4Ortho } from "./math";

function expectClose(actual: number, expected: number, eps = 1e-6): void {
  expect(Math.abs(actual - expected)).toBeLessThan(eps);
}

describe("mat4Identity", () => {
  test("produces 4x4 identity", () => {
    const m = mat4Identity(new Float32Array(16));
    expect(Array.from(m)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  });
});

describe("mat4Ortho", () => {
  test("symmetric ortho centers (0,0) at clip-space origin", () => {
    const m = mat4Ortho(new Float32Array(16), -10, 10, -10, 10, -1, 1);
    const cx = m[12];
    const cy = m[13];
    expect(cx).toBeDefined();
    expect(cy).toBeDefined();
    expectClose(cx as number, 0);
    expectClose(cy as number, 0);
    expectClose(m[0] as number, 0.1);
    expectClose(m[5] as number, 0.1);
  });

  test("maps left/right/bottom/top to clip-space ±1", () => {
    const m = mat4Ortho(new Float32Array(16), 0, 100, 0, 50, -1, 1);
    const project = (x: number, y: number): [number, number] => {
      const [m0, m5, m12, m13] = [m[0], m[5], m[12], m[13]] as [number, number, number, number];
      return [m0 * x + m12, m5 * y + m13];
    };
    const [lx] = project(0, 0);
    const [rx] = project(100, 0);
    const [, by] = project(0, 0);
    const [, ty] = project(0, 50);
    expectClose(lx, -1);
    expectClose(rx, 1);
    expectClose(by, -1);
    expectClose(ty, 1);
  });
});
