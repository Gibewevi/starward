// Light added onto a surface (the floor glowing where a blast burst, a
// molten trail): its texture (linear, white on black) tinted by `tint`, times
// the instance's colour when drawn by a MultiMesh.
shader_type spatial;
render_mode unshaded, blend_add, cull_disabled, depth_draw_never, shadows_disabled;

uniform sampler2D map : filter_linear;
uniform vec3 tint = vec3(1.0);

void fragment() {
	vec4 texel = texture(map, UV);
	ALBEDO = tint * texel.rgb * COLOR.rgb;
	ALPHA = texel.a;
}
