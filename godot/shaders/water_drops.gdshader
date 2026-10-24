// Drops thrown by a splash: two-pixel points, pale, fading as they fall.
shader_type spatial;
render_mode unshaded, blend_mix, cull_disabled, depth_draw_never, shadows_disabled;

void vertex() {
	POINT_SIZE = 2.0;
}

void fragment() {
	if (COLOR.a < 0.02) {
		discard;
	}
	ALBEDO = COLOR.rgb;
	ALPHA = COLOR.a;
}
