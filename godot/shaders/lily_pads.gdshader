// Lily pads riding the waves: each rises and tips with the water under it
// (the simulated heights, `height_map`).
shader_type spatial;
render_mode cull_disabled;

uniform sampler2D height_map : filter_nearest, repeat_disable;
uniform vec2 rect_min;
uniform vec2 rect_size;
uniform vec2 texel;

const float SHAPE = 0.6;

void vertex() {
	vec2 root = MODEL_MATRIX[3].xz;
	vec2 uv = (root - rect_min) / rect_size;
	float rise = clamp(texture(height_map, uv).r * SHAPE, -0.45, 0.16);
	float hx = texture(height_map, uv + vec2(texel.x, 0.0)).r - texture(height_map, uv - vec2(texel.x, 0.0)).r;
	float hz = texture(height_map, uv + vec2(0.0, texel.y)).r - texture(height_map, uv - vec2(0.0, texel.y)).r;
	// Tipped with the slope under it.
	vec3 world_offset = vec3(0.0, rise, 0.0);
	vec3 local = (inverse(mat3(MODEL_MATRIX)) * world_offset);
	VERTEX += local;
	VERTEX.y += (VERTEX.x * hx * 6.0 + VERTEX.z * hz * 6.0) * 0.5;
}

void fragment() {
	ALBEDO = vec3(0.011, 0.058, 0.014);
	ROUGHNESS = 0.35;
}
