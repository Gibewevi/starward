// The marsh's ground (src/jungle.js's floor): mud, wet sand, moss, puddles
// and slabs painted by the web (assets/jungle/ground*.png), its relief from
// the bump map. Where explosions dug it (`crater_map`, m: below 0 a crater, a
// little above at its rim) it sinks, scorched dark, its rim turned over and
// lighter. Under the water (`depth_map`) the bed is dark, tinted by the water
// over it and crossed by the light the ripples gather.
shader_type spatial;

uniform sampler2D albedo_map : source_color, filter_linear_mipmap, repeat_disable;
uniform sampler2D roughness_map : filter_linear_mipmap, repeat_disable;
uniform sampler2D bump_map : filter_linear, repeat_disable;
uniform sampler2D crater_map : filter_linear, repeat_disable;
uniform sampler2D depth_map : filter_linear, repeat_disable;
uniform vec2 rect_min;
uniform vec2 rect_size;
uniform vec2 crater_texel;
uniform float crater_cell = 0.12;
uniform vec2 bump_texel;
uniform float bump_slope = 2.6;

varying vec3 ground;
varying float dug;

void vertex() {
	vec3 at = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	vec2 uv = (at.xz - rect_min) / rect_size;
	dug = texture(crater_map, uv).r;
	VERTEX.y += dug;
	ground = at + vec3(0.0, dug, 0.0);
	UV = uv;
}

void fragment() {
	vec2 uv = UV;
	vec3 colour = texture(albedo_map, uv).rgb;
	float rough = texture(roughness_map, uv).g;
	// Blasted earth: scorched dark in the crater, turned over and lighter on its rim.
	colour *= 1.0 - 0.6 * smoothstep(-0.015, -0.13, dug);
	colour = mix(colour, vec3(0.2, 0.15, 0.1), smoothstep(0.004, 0.035, dug) * 0.5);
	float under = texture(depth_map, uv).r;
	if (under > 0.01) {
		// The marsh's bed: dark, tinted by the water over it, crossed by the light the ripples gather.
		float t = TIME;
		float caustic = pow(abs(sin(ground.x * 3.1 + t * 0.9 + sin(ground.z * 2.7 + t * 0.7)) * sin(ground.z * 3.4 - t * 0.8 + sin(ground.x * 2.2))), 6.0);
		colour = mix(colour, colour * vec3(0.45, 0.65, 0.7), smoothstep(0.0, 0.5, under)) * (1.0 - 0.35 * under) + vec3(0.025, 0.065, 0.075) * caustic * (1.0 - under * 0.6);
		// Under the water the bed is wet, the surface does the shining.
		rough = 0.5;
	} else {
		rough = mix(rough, 0.95, smoothstep(-0.01, -0.06, dug));
	}
	// The relief: the painted bumps, and the crater's slopes.
	float bx = texture(bump_map, uv + vec2(bump_texel.x, 0.0)).r - texture(bump_map, uv - vec2(bump_texel.x, 0.0)).r;
	float bz = texture(bump_map, uv + vec2(0.0, bump_texel.y)).r - texture(bump_map, uv - vec2(0.0, bump_texel.y)).r;
	float cx = (texture(crater_map, uv + vec2(crater_texel.x, 0.0)).r - texture(crater_map, uv - vec2(crater_texel.x, 0.0)).r) / (2.0 * crater_cell);
	float cz = (texture(crater_map, uv + vec2(0.0, crater_texel.y)).r - texture(crater_map, uv - vec2(0.0, crater_texel.y)).r) / (2.0 * crater_cell);
	vec3 n = normalize(vec3(-bx * bump_slope - cx, 1.0, -bz * bump_slope - cz));
	NORMAL = normalize((VIEW_MATRIX * vec4(n, 0.0)).xyz);
	ALBEDO = colour;
	ROUGHNESS = rough;
	METALLIC = 0.08;
}
