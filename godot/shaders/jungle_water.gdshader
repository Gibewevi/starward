// The marsh's water (src/water.js's surface): clear over the sand, darker
// where it is deep, a line of foam along the edge. The simulated waves
// (`height_map`: r height, b the sheet spilt over the bank) shape it — a hole
// where the water was blown away, a wall where it is driven — and their
// slopes catch the moon and the lamps of the ruins as broken glints.
shader_type spatial;
render_mode unshaded, blend_mix, cull_disabled, depth_draw_never, shadows_disabled;

uniform sampler2D height_map : filter_nearest, repeat_disable;
uniform sampler2D depth_map : filter_nearest, repeat_disable;
uniform vec2 texel;
uniform vec2 rect_min;
uniform vec2 rect_size;
uniform vec3 moon_dir = vec3(0.4, 0.8, 0.45);
uniform vec3 moon_color = vec3(0.55, 0.7, 0.9);
uniform vec3 shallow = vec3(0.018, 0.065, 0.072);
uniform vec3 deep = vec3(0.006, 0.016, 0.026);
uniform vec3 sky = vec3(0.02, 0.035, 0.055);
uniform vec3 glint_pos[6];
uniform vec3 glint_color[6];

const float SHAPE = 0.6;

varying vec3 world;

float h(vec2 uv) {
	vec4 cell = texture(height_map, uv);
	return cell.r + cell.b * 2.0;
}

void vertex() {
	// The surface is laid flat, unturned: its own height is the world's.
	vec3 at = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	float rise = clamp(texture(height_map, (at.xz - rect_min) / rect_size).r * SHAPE, -0.45, 0.16);
	VERTEX.y += rise;
	world = at + vec3(0.0, rise, 0.0);
}

void fragment() {
	vec2 uv = (world.xz - rect_min) / rect_size;
	float depth = texture(depth_map, uv).r;
	float film = texture(height_map, uv).b;
	// Over the bank: only where water spilt, a sheet as thin as it is.
	float sheet = depth < 0.02 ? smoothstep(0.0008, 0.01, film) : 1.0;
	if (sheet <= 0.0) {
		discard;
	}
	float time = TIME;
	// The slopes: the simulated ripples, and a fine shiver of the wind on top.
	float dx = h(uv + vec2(texel.x, 0.0)) - h(uv - vec2(texel.x, 0.0));
	float dz = h(uv + vec2(0.0, texel.y)) - h(uv - vec2(0.0, texel.y));
	vec2 wind = vec2(sin(world.x * 3.1 + time * 1.7 + sin(world.z * 2.3 + time)), cos(world.z * 2.7 - time * 1.4 + sin(world.x * 1.9))) * 0.035;
	vec3 n = normalize(vec3(-dx * 9.0 + wind.x, 1.0, -dz * 9.0 + wind.y));
	// The iso camera is orthographic: towards the eye is its backward axis.
	vec3 eye = INV_VIEW_MATRIX[2].xyz;
	float fresnel = pow(1.0 - max(dot(n, eye), 0.0), 3.0);
	// Clear over the sand, darker where deep; the ripples bend the light below.
	float bands = 0.5 + 0.5 * sin((world.x + world.z) * 6.0 + (dx + dz) * 60.0 + time * 0.6);
	vec3 water = mix(shallow, deep, smoothstep(0.1, 0.9, depth)) * (0.85 + 0.25 * bands * (1.0 - depth));
	vec3 colour = mix(water, sky, fresnel * 0.6);
	// The moon, and the lamps of the ruins, glinting on the ripples: broken pinpoints on the pixel grid.
	vec3 r = reflect(-eye, n);
	vec2 pixel = floor(world.xz * 28.0);
	float sparkle = fract(sin(dot(pixel, vec2(127.1, 311.7))) * 43758.5453);
	float broken = smoothstep(0.3, 0.85, sparkle + sin(time * 1.2 + pixel.y * 0.6) * 0.12);
	colour += moon_color * pow(max(dot(r, normalize(moon_dir)), 0.0), 110.0) * 0.45 * broken;
	for (int i = 0; i < 6; i++) {
		vec3 to_light = glint_pos[i] - world;
		float far = length(to_light);
		float s = pow(max(dot(r, to_light / max(far, 1e-3)), 0.0), 90.0) / (1.0 + far * far * 0.12);
		colour += glint_color[i] * s * 4.0 * (0.2 + broken * 0.8);
	}
	// Foam along the edge, where the water is churned, and at the front of a spilt sheet.
	float churn = clamp(abs(dx) * 18.0 + abs(dz) * 18.0, 0.0, 1.0);
	float lip = depth < 0.02 ? (1.0 - smoothstep(0.002, 0.014, film)) * 2.2 : 0.0;
	float foam = smoothstep(0.2, 0.04, depth) * (0.55 + 0.45 * sin(world.x * 23.0 + time * 2.0) * sin(world.z * 19.0 - time * 1.7)) * step(0.02, depth) + churn * 0.35 + lip;
	colour = mix(colour, vec3(0.13, 0.23, 0.24), clamp(foam * 0.35, 0.0, 0.45));
	colour = mix(colour, vec3(0.42, 0.55, 0.55), clamp(lip * sheet * 0.35, 0.0, 0.6));
	ALBEDO = colour;
	ALPHA = clamp((mix(0.3, 0.58, smoothstep(0.05, 0.8, depth)) + fresnel * 0.15 + foam * 0.12 + (depth < 0.02 ? 0.25 : 0.0)) * sheet, 0.0, 1.0);
}
