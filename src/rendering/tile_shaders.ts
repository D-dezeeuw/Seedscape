// GLSL ES 3.00 source for the single tile shader pair. One vertex + one
// fragment shader handles every tile. Per docs/15_rendering_shaders.md.

export const TILE_VERTEX_SOURCE = /* glsl */ `#version 300 es
precision highp float;

in vec2  a_quadPos;     // [-0.5, 0.5] unit quad (per-vertex)
in vec2  a_tileWorld;   // tile world position (per-instance)
in float a_tileIndex;   // atlas tile index (per-instance)
in float a_stateFlags;  // packed render state (per-instance)

uniform mat4  u_viewProjection;
uniform vec2  u_atlasSize;   // atlas dimensions in tiles (e.g. 64x64)
uniform float u_tileSize;    // world units per tile

out vec2  v_uv;
out float v_stateFlags;

void main() {
  vec2 worldPos = a_tileWorld + (a_quadPos + 0.5) * u_tileSize;
  gl_Position = u_viewProjection * vec4(worldPos, 0.0, 1.0);

  float col = mod(a_tileIndex, u_atlasSize.x);
  float row = floor(a_tileIndex / u_atlasSize.x);

  // Atlas convention: tile id N at image (col=N%cols, row=floor(N/cols))
  // with row 0 at image top. Texture is uploaded with UNPACK_FLIP_Y off,
  // so image row 0 → UV.y = 0. World Y is up, so the top of the rendered
  // tile (a_quadPos.y = +0.5) must sample the top of the cell — hence
  // the negation on a_quadPos.y. Flipping that sign would render every
  // tile upside down.
  v_uv = vec2(
    (col + a_quadPos.x + 0.5) / u_atlasSize.x,
    (row - a_quadPos.y + 0.5) / u_atlasSize.y
  );

  v_stateFlags = a_stateFlags;
}
`;

export const TILE_FRAGMENT_SOURCE = /* glsl */ `#version 300 es
precision highp float;

in vec2  v_uv;
in float v_stateFlags;

uniform sampler2D u_atlas;
uniform float     u_time;

out vec4 fragColor;

void main() {
  vec4 color = texture(u_atlas, v_uv);

  int flags = int(v_stateFlags);
  int wilted   = (flags >> 0) & 1;
  int watered  = (flags >> 1) & 1;
  int selected = (flags >> 2) & 1;

  if (wilted == 1) {
    float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    color.rgb = mix(color.rgb, vec3(gray), 0.7);
  }

  if (watered == 1) {
    float shimmer = 0.05 * sin(u_time * 3.0 + v_uv.y * 10.0);
    color.b += shimmer;
  }

  if (selected == 1) {
    color.rgb = mix(color.rgb, vec3(1.0, 1.0, 0.5), 0.3);
  }

  fragColor = color;
}
`;
