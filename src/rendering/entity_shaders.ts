// Placeholder entity sprite shader. Draws a colored disc with a small
// "facing notch" so the player can read direction at a glance. No atlas
// sample yet — real art lands in a later phase, at which point this
// gets replaced with a textured-quad path that mirrors tile_shaders.

export const ENTITY_VERTEX_SOURCE = /* glsl */ `#version 300 es
precision highp float;

in vec2  a_quadPos;     // [-0.5, 0.5] unit quad (per-vertex)
in vec2  a_worldPos;    // entity world position (per-instance, sub-tile)
in vec3  a_color;       // base body color (per-instance)
in float a_facing;      // 0=S, 1=W, 2=N, 3=E (per-instance)

uniform mat4  u_viewProjection;
uniform float u_tileSize;

out vec2  v_uv;
out vec3  v_color;
flat out int v_facing;

void main() {
  vec2 worldPos = a_worldPos + a_quadPos * u_tileSize * 0.85;
  gl_Position = u_viewProjection * vec4(worldPos, 0.0, 1.0);
  v_uv = a_quadPos;        // [-0.5, 0.5]
  v_color = a_color;
  v_facing = int(a_facing);
}
`;

export const ENTITY_FRAGMENT_SOURCE = /* glsl */ `#version 300 es
precision highp float;

in  vec2 v_uv;
in  vec3 v_color;
flat in int v_facing;

out vec4 fragColor;

void main() {
  // Disc with anti-aliased edge.
  float r = length(v_uv);
  if (r > 0.5) discard;

  // Body color, with a darker rim so the entity stands out against tiles.
  float rim = smoothstep(0.40, 0.50, r);
  vec3 body = mix(v_color, v_color * 0.55, rim);

  // Facing notch — a small darker spot at the front of the body. World
  // coords match chunkY-down, so south is +y in v_uv.
  vec2 notchOffset;
  if      (v_facing == 0) notchOffset = vec2( 0.0,  0.28); // south
  else if (v_facing == 1) notchOffset = vec2(-0.28, 0.0);  // west
  else if (v_facing == 2) notchOffset = vec2( 0.0, -0.28); // north
  else                     notchOffset = vec2( 0.28, 0.0); // east

  float notchDist = length(v_uv - notchOffset);
  float notch = smoothstep(0.12, 0.06, notchDist);
  body = mix(body, v_color * 0.25, notch);

  fragColor = vec4(body, 1.0);
}
`;
