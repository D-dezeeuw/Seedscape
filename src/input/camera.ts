import { type Mat4, mat4Ortho } from "../core/math";

// 2D orthographic camera. Position is the world-space point shown at screen
// center; zoom is "world units per screen pixel" (smaller = more zoomed in).

export class Camera {
  x = 0;
  y = 0;
  zoom = 0.05; // world units per pixel
  readonly viewProjection: Mat4 = new Float32Array(16);

  updateViewProjection(viewportWidth: number, viewportHeight: number): void {
    const halfW = (viewportWidth * this.zoom) / 2;
    const halfH = (viewportHeight * this.zoom) / 2;
    mat4Ortho(
      this.viewProjection,
      this.x - halfW,
      this.x + halfW,
      this.y - halfH,
      this.y + halfH,
      -1,
      1,
    );
  }
}
