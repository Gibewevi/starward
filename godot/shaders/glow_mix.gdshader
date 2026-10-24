// A soft glow facing the camera, laid over the scene (not added light) (a flare, a muzzle
// flash, an aim glint): its texture tinted by `tint` (bright enough to bloom),
// `tint.a` its opacity, turned by `spin` in the view's plane.
shader_type spatial;
render_mode unshaded, blend_mix, cull_disabled, depth_draw_never, shadows_disabled;

uniform sampler2D map : source_color, filter_linear;
uniform vec4 tint = vec4(1.0);
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
	vec4 texel = texture(map, UV);
	ALBEDO = tint.rgb * texel.rgb;
	ALPHA = texel.a * tint.a;
}
