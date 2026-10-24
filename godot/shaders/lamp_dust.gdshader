// The dust a lamp's beam reveals: round points of UV.x pixels, the warm
// light's tint times how much light each catches (UV.y), added onto the scene.
shader_type spatial;
render_mode unshaded, blend_add, cull_disabled, depth_draw_never, shadows_disabled, fog_disabled;

uniform vec3 tint = vec3(1.0);

varying float glow;

void vertex() {
	POINT_SIZE = UV.x;
	glow = UV.y;
}

void fragment() {
	vec2 c = POINT_COORD - 0.5;
	float d = dot(c, c) * 4.0;
	if (d > 1.0 || glow < 0.01) {
		discard;
	}
	ALBEDO = tint * glow * (1.0 - d);
	ALPHA = 1.0;
}
