import { TILES_PER_CHUNK } from "../world/chunk";
import type { AtlasTexture } from "./atlas";
import { createProgram, getAttribLocation, getUniformLocation } from "./shader";
import { TILE_FRAGMENT_SOURCE, TILE_VERTEX_SOURCE } from "./tile_shaders";

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

const INSTANCE_FLOATS_PER_TILE = 4;
const INSTANCE_STRIDE_BYTES = INSTANCE_FLOATS_PER_TILE * 4;

interface ChunkHandle {
  vao: WebGLVertexArrayObject;
  instanceBuffer: WebGLBuffer;
  instanceCount: number;
}

export class InstancedTileRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly atlas: AtlasTexture;
  private readonly tileSize: number;
  private readonly program: WebGLProgram;
  private readonly quadBuffer: WebGLBuffer;
  private readonly attribLocs: {
    quadPos: number;
    tileWorld: number;
    tileIndex: number;
    stateFlags: number;
  };
  private readonly uniformLocs: {
    viewProjection: WebGLUniformLocation;
    atlasSize: WebGLUniformLocation;
    tileSize: WebGLUniformLocation;
    atlas: WebGLUniformLocation;
    time: WebGLUniformLocation;
  };
  private readonly chunks = new Map<string, ChunkHandle>();

  constructor(gl: WebGL2RenderingContext, atlas: AtlasTexture, tileSize: number) {
    this.gl = gl;
    this.atlas = atlas;
    this.tileSize = tileSize;

    this.program = createProgram(gl, TILE_VERTEX_SOURCE, TILE_FRAGMENT_SOURCE);

    this.attribLocs = {
      quadPos: getAttribLocation(gl, this.program, "a_quadPos"),
      tileWorld: getAttribLocation(gl, this.program, "a_tileWorld"),
      tileIndex: getAttribLocation(gl, this.program, "a_tileIndex"),
      stateFlags: getAttribLocation(gl, this.program, "a_stateFlags"),
    };
    this.uniformLocs = {
      viewProjection: getUniformLocation(gl, this.program, "u_viewProjection"),
      atlasSize: getUniformLocation(gl, this.program, "u_atlasSize"),
      tileSize: getUniformLocation(gl, this.program, "u_tileSize"),
      atlas: getUniformLocation(gl, this.program, "u_atlas"),
      time: getUniformLocation(gl, this.program, "u_time"),
    };

    const quadBuffer = gl.createBuffer();
    if (!quadBuffer) throw new Error("gl.createBuffer (quad) returned null");
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD_VERTICES, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this.quadBuffer = quadBuffer;
  }

  // Add or replace the chunk identified by `key`. If a chunk with this key
  // already exists its GL resources are released first. Reupload is the
  // simplest correct DIRTY_RENDER path; later phases can grow this into an
  // in-place bufferSubData if profiling demands it.
  addChunk(key: string, instanceData: Float32Array): void {
    const expectedFloats = TILES_PER_CHUNK * INSTANCE_FLOATS_PER_TILE;
    if (instanceData.length !== expectedFloats) {
      throw new Error(
        `instance buffer size mismatch: got ${instanceData.length} floats, expected ${expectedFloats}`,
      );
    }

    if (this.chunks.has(key)) this.removeChunk(key);

    const gl = this.gl;
    const vao = gl.createVertexArray();
    if (!vao) throw new Error("gl.createVertexArray returned null");
    const instanceBuffer = gl.createBuffer();
    if (!instanceBuffer) throw new Error("gl.createBuffer (instance) returned null");

    gl.bindVertexArray(vao);

    // Per-vertex shared quad
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(this.attribLocs.quadPos);
    gl.vertexAttribPointer(this.attribLocs.quadPos, 2, gl.FLOAT, false, 0, 0);

    // Per-instance interleaved
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, instanceData, gl.STATIC_DRAW);

    gl.enableVertexAttribArray(this.attribLocs.tileWorld);
    gl.vertexAttribPointer(this.attribLocs.tileWorld, 2, gl.FLOAT, false, INSTANCE_STRIDE_BYTES, 0);
    gl.vertexAttribDivisor(this.attribLocs.tileWorld, 1);

    gl.enableVertexAttribArray(this.attribLocs.tileIndex);
    gl.vertexAttribPointer(this.attribLocs.tileIndex, 1, gl.FLOAT, false, INSTANCE_STRIDE_BYTES, 8);
    gl.vertexAttribDivisor(this.attribLocs.tileIndex, 1);

    gl.enableVertexAttribArray(this.attribLocs.stateFlags);
    gl.vertexAttribPointer(
      this.attribLocs.stateFlags,
      1,
      gl.FLOAT,
      false,
      INSTANCE_STRIDE_BYTES,
      12,
    );
    gl.vertexAttribDivisor(this.attribLocs.stateFlags, 1);

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    this.chunks.set(key, { vao, instanceBuffer, instanceCount: TILES_PER_CHUNK });
  }

  removeChunk(key: string): void {
    const handle = this.chunks.get(key);
    if (!handle) return;
    this.gl.deleteBuffer(handle.instanceBuffer);
    this.gl.deleteVertexArray(handle.vao);
    this.chunks.delete(key);
  }

  hasChunk(key: string): boolean {
    return this.chunks.has(key);
  }

  *chunkKeys(): IterableIterator<string> {
    yield* this.chunks.keys();
  }

  get chunkCount(): number {
    return this.chunks.size;
  }

  get tileCount(): number {
    return this.chunks.size * TILES_PER_CHUNK;
  }

  // Release every owned GL resource (program, quad buffer, per-chunk VAOs +
  // instance buffers). Symmetric with InstancedEntityRenderer.destroy. Safe
  // to call multiple times — chunks Map is cleared after the first call so
  // the second iteration is a no-op.
  destroy(): void {
    const gl = this.gl;
    for (const handle of this.chunks.values()) {
      gl.deleteBuffer(handle.instanceBuffer);
      gl.deleteVertexArray(handle.vao);
    }
    this.chunks.clear();
    gl.deleteBuffer(this.quadBuffer);
    gl.deleteProgram(this.program);
  }

  draw(viewProjection: Float32Array, timeSeconds: number): void {
    const gl = this.gl;
    gl.useProgram(this.program);

    gl.uniformMatrix4fv(this.uniformLocs.viewProjection, false, viewProjection);
    const atlasInTiles = this.atlas.tilesPerRow;
    gl.uniform2f(this.uniformLocs.atlasSize, atlasInTiles, atlasInTiles);
    gl.uniform1f(this.uniformLocs.tileSize, this.tileSize);
    gl.uniform1f(this.uniformLocs.time, timeSeconds);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas.texture);
    gl.uniform1i(this.uniformLocs.atlas, 0);

    for (const chunk of this.chunks.values()) {
      gl.bindVertexArray(chunk.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, chunk.instanceCount);
    }
    gl.bindVertexArray(null);
  }
}
