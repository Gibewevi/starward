// The explosion's fire and smoke: the flipbook on a quad facing the camera,
// a little nearer to it than the blast (`depth_bias`) so the floor in front
// does not cut it; the incandescent parts made light (`glow`).
shader_type spatial;
render_mode unshaded, blend_premul_alpha, cull_disabled, depth_draw_never, shadows_disabled;

#include "res://shaders/explosion_flipbook.gdshaderinc"

uniform float glow = 1.8;
uniform float opacity = 1.0;
uniform float depth_bias = 1.1;

void vertex() {
	MODELVIEW_MATRIX = VIEW_MATRIX * mat4(
		INV_VIEW_MATRIX[0] * length(MODEL_MATRIX[0].xyz),
		INV_VIEW_MATRIX[1] * length(MODEL_MATRIX[1].xyz),
		INV_VIEW_MATRIX[2],
		vec4(MODEL_MATRIX[3].xyz + INV_VIEW_MATRIX[2].xyz * depth_bias, 1.0));
}

void fragment() {
	vec4 c = flipbook(UV);
	if (c.a < 0.004) {
		discard;
	}
	float alpha = c.a * opacity;
	float heat = heat_of(c, UV);
	ALBEDO = c.rgb * (1.0 + heat * heat * glow) * alpha;
	ALPHA = alpha;
}
