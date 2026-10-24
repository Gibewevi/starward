// A trooper's aim glint: a red star at his muzzle (a soft core and four thin
// rays), added over everything — seen even behind the crate he leans out of —,
// facing the camera, turned by `spin`.
shader_type spatial;
render_mode unshaded, blend_add, cull_disabled, depth_draw_never, depth_test_disabled, shadows_disabled, fog_disabled;

uniform vec4 tint = vec4(1.6, 0.08, 0.05, 1.0);
uniform float spin = 0.0;

void vertex() {
	float c = cos(spin);
	float s = sin(spin);
	VERTEX.xy = mat2(vec2(c, s), vec2(-s, c)) * VERTEX.xy;
	MODELVIEW_MATRIX = VIEW_MATRIX * mat4(
		INV_VIEW_MATRIX[0] * length(MODEL_MATRIX[0].xyz),
		INV_VIEW_MATRIX[1] * length(MODEL_MATRIX[1].xyz),
		INV_VIEW_MATRIX[2] * length(MODEL_MATRIX[2].xyz),
		MODEL_MATRIX[3]);
}

void fragment() {
	vec2 p = UV * 2.0 - 1.0;
	float d = min(1.0, length(p));
	float rays = max(0.0, 1.0 - min(abs(p.x), abs(p.y)) * 14.0) * pow(1.0 - d, 1.5);
	ALBEDO = tint.rgb;
	ALPHA = min(1.0, pow(1.0 - d, 3.0) + rays) * tint.a;
}
