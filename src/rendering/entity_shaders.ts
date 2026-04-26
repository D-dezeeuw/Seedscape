// Placeholder entity sprite shader. Draws a colored disc with a small
// "facing notch" so the player can read direction at a glance, plus a
// yellow rim when the entity is currently selected in the UI.
//
// Per-instance encoding: a_facing's low 2 bits = facing direction
// (0=S, 1=W, 2=N, 3=E); bit 2 = selection flag (yellow ring); bit 3 =
// possessed flag (cyan ring, drawn over selection).

export const ENTITY_VERTEX_SOURCE = /* glsl */ `#version 300 es
precision highp float;

in vec2  a_quadPos;     // [-0.5, 0.5] unit quad (per-vertex)
in vec2  a_worldPos;    // entity world position (per-instance, sub-tile)
in vec3  a_color;       // base body color (per-instance)
in float a_facing;      // packed: facing in low 2 bits, selected in bit 2

uniform mat4  u_viewProjection;
uniform float u_tileSize;

out vec2  v_uv;
out vec3  v_color;
flat out int v_facing;
flat out int v_selected;
flat out int v_possessed;

void main() {
  vec2 worldPos = a_worldPos + a_quadPos * u_tileSize * 0.85;
  gl_Position = u_viewProjection * vec4(worldPos, 0.0, 1.0);
  v_uv = a_quadPos;
  v_color = a_color;

  int packed = int(a_facing);
  v_facing    = packed & 3;
  v_selected  = (packed >> 2) & 1;
  v_possessed = (packed >> 3) & 1;
}
`;

export const ENTITY_FRAGMENT_SOURCE = /* glsl */ `#version 300 es
precision highp float;

in  vec2 v_uv;
in  vec3 v_color;
flat in int v_facing;
flat in int v_selected;
flat in int v_possessed;

out vec4 fragColor;

void main() {
  float r = length(v_uv);
  if (r > 0.5) discard;

  // Body with darker rim for contrast.
  float rim = smoothstep(0.40, 0.50, r);
  vec3 body = mix(v_color, v_color * 0.55, rim);

  // Facing notch — small darker dot at the front.
  vec2 notchOffset;
  if      (v_facing == 0) notchOffset = vec2( 0.0,  0.28); // south
  else if (v_facing == 1) notchOffset = vec2(-0.28, 0.0);  // west
  else if (v_facing == 2) notchOffset = vec2( 0.0, -0.28); // north
  else                     notchOffset = vec2( 0.28, 0.0); // east

  float notchDist = length(v_uv - notchOffset);
  float notch = smoothstep(0.12, 0.06, notchDist);
  body = mix(body, v_color * 0.25, notch);

  // Selection ring: bright yellow band at the outer edge of the disc.
  if (v_selected == 1) {
    float ring = smoothstep(0.42, 0.48, r) * (1.0 - smoothstep(0.48, 0.50, r));
    body = mix(body, vec3(1.0, 0.92, 0.45), ring);
  }

  // Possessed ring: cyan, slightly inside the selection ring so both can
  // coexist when the player has the possessed entity also selected in
  // a UI panel. Possession is "I am this", selection is "I'm reading
  // about this" — distinct concepts, distinct visuals.
  if (v_possessed == 1) {
    float ring = smoothstep(0.36, 0.42, r) * (1.0 - smoothstep(0.42, 0.46, r));
    body = mix(body, vec3(0.45, 0.85, 1.0), ring);
  }

  fragColor = vec4(body, 1.0);
}
`;
