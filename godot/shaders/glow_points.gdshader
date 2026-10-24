// Glowing beads added onto the scene (sparks, molten drops, embers): round,
// soft-edged points of `UV.x` pixels; the vertex colours carry the glow
// divided by `brightness` (they are stored in 8 bits), given back here.
shader_type spatial;
render_mode unshaded, blend_add, cull_disabled, depth_draw_never, shadows_disabled;

uniform float brightness = 4.5;

void vertex() {
	POINT_SIZE = UV.x;
}

void fragment() {
	vec2 c = POINT_COORD - 0.5;
	float d = dot(c, c) * 4.0;
	if (d > 1.0) {
		discard;
	}
	ALBEDO = COLOR.rgb * brightness * (1.0 - d * 0.7);
}
