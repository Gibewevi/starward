// A waterfall's sheet (src/jungle-props.js): streaks running down, faster
// lower, thinning at the sides.
shader_type spatial;
render_mode unshaded, blend_mix, cull_disabled, depth_draw_never, shadows_disabled;

float n(vec2 p) {
	return fract(sin(dot(floor(p), vec2(127.1, 311.7))) * 43758.5453);
}

void fragment() {
	// The web's v runs up the sheet; Godot's down.
	vec2 uv = vec2(UV.x, 1.0 - UV.y);
	float x = uv.x * 14.0;
	float fall = TIME * (2.2 + (1.0 - uv.y) * 2.5);
	float streak = n(vec2(x, uv.y * 10.0 + fall)) * 0.6 + n(vec2(x * 2.3, uv.y * 22.0 + fall * 1.6)) * 0.4;
	float edge = smoothstep(0.0, 0.12, uv.x) * smoothstep(1.0, 0.88, uv.x);
	ALBEDO = mix(vec3(0.05, 0.16, 0.18), vec3(0.62, 0.78, 0.8), smoothstep(0.35, 0.95, streak));
	ALPHA = edge * (0.45 + 0.4 * streak) * (0.75 + 0.25 * uv.y);
}
