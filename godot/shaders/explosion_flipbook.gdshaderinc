// The Blender flipbook of the explosion (assets/fx/explosion.png, 8 × 8
// frames): straight-alpha colour, and a linear heat mask beside it (only the
// incandescent parts glow, soot stays dark). Two authored frames are blended
// in premultiplied space (coverage, not the colour of transparent pixels).
uniform sampler2D map : source_color, filter_nearest;
uniform sampler2D heat_map : filter_nearest;
uniform float frame_a = 0.0;
uniform float frame_b = 0.0;
uniform float between = 0.0;
uniform float columns = 8.0;
uniform float rows = 8.0;
uniform float cell_size = 256.0;
uniform float has_heat = 1.0;

vec2 frame_uv(float index, vec2 uv) {
	float column = mod(index, columns);
	float row = floor(index / columns);
	// Never filter across a neighbouring cell, its empty edge included.
	uv = clamp(uv, vec2(0.5 / cell_size), vec2(1.0 - 0.5 / cell_size));
	return vec2((column + uv.x) / columns, (row + uv.y) / rows);
}

vec4 flipbook(vec2 uv) {
	if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
		return vec4(0.0);
	}
	vec4 a = texture(map, frame_uv(frame_a, uv));
	vec4 b = texture(map, frame_uv(frame_b, uv));
	float alpha = mix(a.a, b.a, between);
	return vec4(mix(a.rgb * a.a, b.rgb * b.a, between) / max(alpha, 0.00001), alpha);
}

float heat_of(vec4 c, vec2 uv) {
	float warm = clamp((c.r - c.b) * 2.0, 0.0, 1.0) * smoothstep(0.25, 0.8, c.r);
	float fallback = max(warm, smoothstep(0.75, 0.98, min(c.r, min(c.g, c.b))));
	float heat = mix(texture(heat_map, frame_uv(frame_a, uv)).r, texture(heat_map, frame_uv(frame_b, uv)).r, between);
	return mix(fallback, heat, has_heat);
}

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float value_noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
