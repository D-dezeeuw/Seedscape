// Renders all live entities as colored discs with a facing notch. One
// instanced draw call per frame, buffer rebuilt every frame from the
// EntityManager — at MVP scale (≤16 entities) the upload cost is
// negligible. Replace with a textured-quad path that samples the atlas
// when real character art ships.

import type { Entity, EntityType } from "../state/entities/entity";
import { ENTITY_FRAGMENT_SOURCE, ENTITY_VERTEX_SOURCE } from "./entity_shaders";
import { createProgram, getAttribLocation, getUniformLocation } from "./shader";

const QUAD_VERTICES = new Float32Array([
  -0.5,
  -0.5, // bottom-left
  0.5,
  -0.5, // bottom-right
  -0.5,
  0.5, // top-left
  0.5,
  0.5, // top-right
]);

// Per-instance: worldX, worldY, R, G, B, facing
const FLOATS_PER_ENTITY = 6;
const STRIDE_BYTES = FLOATS_PER_ENTITY * 4;
// Initial buffer capacity — grows on demand if we ever ship more than this.
const INITIAL_CAPACITY = 32;

const COLORS: Record<EntityType, [number, number, number]> = {
  villager: [0.92, 0.79, 0.62],
  animal: [0.55, 0.4, 0.28],
  pet: [0.78, 0.62, 0.43],
  mount: [0.55, 0.55, 0.55],
};

export class InstancedEntityRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly tileSize: number;
  private readonly vao: WebGLVertexArrayObject;
  private readonly quadBuffer: WebGLBuffer;
  private readonly instanceBuffer: WebGLBuffer;
  private readonly uniformLocs: {
    viewProjection: WebGLUniformLocation;
    tileSize: WebGLUniformLocation;
  };
  private capacity = INITIAL_CAPACITY;
  private cpuBuffer = new Float32Array(INITIAL_CAPACITY * FLOATS_PER_ENTITY);
  // Reused across draw() calls so the per-frame z-sort doesn't allocate a
  // fresh array (length grows with entity count; reset to 0 each frame
  // without releasing the backing storage).
  private readonly sortScratch: Entity[] = [];

  constructor(gl: WebGL2RenderingContext, tileSize: number) {
    this.gl = gl;
    this.tileSize = tileSize;
    this.program = createProgram(gl, ENTITY_VERTEX_SOURCE, ENTITY_FRAGMENT_SOURCE);

    const quadPosLoc = getAttribLocation(gl, this.program, "a_quadPos");
    const worldPosLoc = getAttribLocation(gl, this.program, "a_worldPos");
    const colorLoc = getAttribLocation(gl, this.program, "a_color");
    const facingLoc = getAttribLocation(gl, this.program, "a_facing");

    this.uniformLocs = {
      viewProjection: getUniformLocation(gl, this.program, "u_viewProjection"),
      tileSize: getUniformLocation(gl, this.program, "u_tileSize"),
    };

    const quadBuffer = gl.createBuffer();
    if (!quadBuffer) throw new Error("gl.createBuffer (entity quad) returned null");
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD_VERTICES, gl.STATIC_DRAW);
    this.quadBuffer = quadBuffer;

    const instanceBuffer = gl.createBuffer();
    if (!instanceBuffer) throw new Error("gl.createBuffer (entity instance) returned null");
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.cpuBuffer.byteLength, gl.DYNAMIC_DRAW);
    this.instanceBuffer = instanceBuffer;

    const vao = gl.createVertexArray();
    if (!vao) throw new Error("gl.createVertexArray (entity) returned null");
    gl.bindVertexArray(vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.enableVertexAttribArray(quadPosLoc);
    gl.vertexAttribPointer(quadPosLoc, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
    gl.enableVertexAttribArray(worldPosLoc);
    gl.vertexAttribPointer(worldPosLoc, 2, gl.FLOAT, false, STRIDE_BYTES, 0);
    gl.vertexAttribDivisor(worldPosLoc, 1);

    gl.enableVertexAttribArray(colorLoc);
    gl.vertexAttribPointer(colorLoc, 3, gl.FLOAT, false, STRIDE_BYTES, 8);
    gl.vertexAttribDivisor(colorLoc, 1);

    gl.enableVertexAttribArray(facingLoc);
    gl.vertexAttribPointer(facingLoc, 1, gl.FLOAT, false, STRIDE_BYTES, 20);
    gl.vertexAttribDivisor(facingLoc, 1);

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this.vao = vao;
  }

  draw(
    entities: Iterable<Entity>,
    viewProjection: Float32Array,
    selectedId: number | null = null,
    possessedId: number | null = null,
  ): void {
    // Z-sort by worldY so south-most draws last (on top). The scratch
    // array is reused across frames; .length=0 keeps its allocated
    // backing so push() steady-state allocates nothing.
    const sorted = this.sortScratch;
    sorted.length = 0;
    for (const e of entities) sorted.push(e);
    sorted.sort((a, b) => a.worldY() - b.worldY());

    const count = sorted.length;
    if (count === 0) return;
    while (count > this.capacity) this.grow(this.capacity * 2);

    for (let i = 0; i < count; i++) {
      const e = sorted[i] as Entity;
      const off = i * FLOATS_PER_ENTITY;
      this.cpuBuffer[off] = e.worldX() + 0.5;
      this.cpuBuffer[off + 1] = e.worldY() + 0.5;
      const c = COLORS[e.type];
      this.cpuBuffer[off + 2] = c[0];
      this.cpuBuffer[off + 3] = c[1];
      this.cpuBuffer[off + 4] = c[2];
      // Pack facing (low 2 bits) + selected (bit 2) + possessed (bit 3)
      // into one float. Decoder lives in entity_shaders.ts.
      const selected = e.id === selectedId ? 1 : 0;
      const possessed = e.id === possessedId ? 1 : 0;
      this.cpuBuffer[off + 5] = e.facing | (selected << 2) | (possessed << 3);
    }

    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uniformLocs.viewProjection, false, viewProjection);
    gl.uniform1f(this.uniformLocs.tileSize, this.tileSize);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.cpuBuffer, 0, count * FLOATS_PER_ENTITY);

    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  destroy(): void {
    const gl = this.gl;
    gl.deleteBuffer(this.quadBuffer);
    gl.deleteBuffer(this.instanceBuffer);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
  }

  private grow(newCapacity: number): void {
    this.capacity = newCapacity;
    this.cpuBuffer = new Float32Array(newCapacity * FLOATS_PER_ENTITY);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, this.cpuBuffer.byteLength, this.gl.DYNAMIC_DRAW);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null);
  }
}
