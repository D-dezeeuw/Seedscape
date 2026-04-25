// Column-major 4x4 matrix utilities sized for an orthographic 2D camera.
// Tile renderer is the only client; only the operations used there are exposed.

export type Mat4 = Float32Array;

export function mat4Identity(out: Mat4): Mat4 {
  out.fill(0);
  out[0] = 1;
  out[5] = 1;
  out[10] = 1;
  out[15] = 1;
  return out;
}

export function mat4Ortho(
  out: Mat4,
  left: number,
  right: number,
  bottom: number,
  top: number,
  near: number,
  far: number,
): Mat4 {
  const rl = 1 / (right - left);
  const tb = 1 / (top - bottom);
  const fn = 1 / (far - near);
  out[0] = 2 * rl;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  out[4] = 0;
  out[5] = 2 * tb;
  out[6] = 0;
  out[7] = 0;
  out[8] = 0;
  out[9] = 0;
  out[10] = -2 * fn;
  out[11] = 0;
  out[12] = -(right + left) * rl;
  out[13] = -(top + bottom) * tb;
  out[14] = -(far + near) * fn;
  out[15] = 1;
  return out;
}
