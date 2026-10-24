// A ring racing out over the floor from a blast (the shockwave, the dust
// behind it): a ragged band of noisy cloud.
uniform vec3 color = vec3(1.0);
uniform float opacity = 1.0;
uniform float phase = 0.0;
uniform float seed = 0.0;

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float value_noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

void fragment() {
	vec2 p = (UV - 0.5) * 2.0;
	float n = value_noise(p * 6.0 + seed + phase * 0.7);
	float r = length(p) + (n - 0.5) * 0.24;
	float band = smoothstep(0.32, 0.65, r) * (1.0 - smoothstep(0.69, 0.94, r));
	float cloud = smoothstep(0.2, 0.7, value_noise(p * 13.0 - seed));
	ALBEDO = color;
	ALPHA = band * cloud * opacity;
}
