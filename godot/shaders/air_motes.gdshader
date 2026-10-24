// Motes and fireflies in the jungle's air: points of light added onto the
// scene, their colour in the vertex colour (over BRIGHT: vertex colours stop
// at 1; bright enough to bloom once multiplied back), their size in UV.x.
shader_type spatial;
render_mode unshaded, blend_add, cull_disabled, depth_draw_never, shadows_disabled, fog_disabled;

const float BRIGHT = 2.5;

void vertex() {
	POINT_SIZE = UV.x;
}

void fragment() {
	ALBEDO = COLOR.rgb * BRIGHT;
	ALPHA = 1.0;
}
