// A rifle lamp's beam as light caught in the dusty air (port of
// src/beam-pass.js, one beam a box round it): along each pixel's line of
// sight, stepped through the beam up to whatever stands there (the scene's
// depth: the floor, a crate, a man), the light of every step is added up —
// strongest near the lamp and on the axis, soft at the edges, thickened and
// thinned by a slow haze. The steps start a little further on from one pixel
// to the next (a 4×4 Bayer pattern): a fine pixel grain, not bands.
shader_type spatial;
render_mode unshaded, blend_add, cull_front, depth_draw_never, depth_test_disabled, shadows_disabled, fog_disabled;

#define STEPS 16

uniform sampler2D depth_texture : hint_depth_texture, filter_nearest;
uniform vec3 lens;
uniform vec3 axis = vec3(0.0, 0.0, 1.0);
uniform float beam_length = 4.4;
uniform float on = 0.0;
uniform vec3 tint = vec3(1.0);
uniform float level = 0.7;
uniform float spread = 0.3;
uniform float full = 4.4;
uniform float haze = 0.45;
uniform float time = 0.0;

float bayer2(vec2 a) {
	a = floor(a);
	return fract(dot(a, vec2(0.5, a.y * 0.75)));
}

float bayer4(vec2 a) {
	return bayer2(0.5 * a) * 0.25 + bayer2(a);
}

float hash(vec3 p) {
	p = fract(p * 0.3183099 + 0.1);
	p *= 17.0;
	return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 x) {
	vec3 i = floor(x);
	vec3 f = fract(x);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
		mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

vec3 world_at(vec2 uv, float depth, mat4 inverse_projection, mat4 inverse_view) {
	vec4 view = inverse_projection * vec4(uv * 2.0 - 1.0, depth, 1.0);
	return (inverse_view * vec4(view.xyz / view.w, 1.0)).xyz;
}

void fragment() {
	// From the near plane (depth 1: Godot's depth runs backwards) to what stands there.
	vec3 from = world_at(SCREEN_UV, 1.0, INV_PROJECTION_MATRIX, INV_VIEW_MATRIX);
	vec3 to = world_at(SCREEN_UV, texture(depth_texture, SCREEN_UV).r, INV_PROJECTION_MATRIX, INV_VIEW_MATRIX);
	float far = length(to - from);
	vec3 ray = (to - from) / far;
	float jitter = bayer4(FRAGCOORD.xy);
	vec3 drift = vec3(time * 0.07, time * 0.03, -time * 0.05);
	float glow = 0.0;
	// Only the stretch of the ray inside the sphere round the beam, and before what stands there.
	vec3 centre = lens + axis * beam_length * 0.5;
	float bound = 0.25 * beam_length * beam_length + spread * spread * beam_length * beam_length;
	vec3 oc = from - centre;
	float b = dot(oc, ray);
	float h = b * b - dot(oc, oc) + bound;
	if (h > 0.0) {
		h = sqrt(h);
		float t0 = max(-b - h, 0.0);
		float t1 = min(-b + h, far);
		if (t1 > t0) {
			float step_length = (t1 - t0) / float(STEPS);
			float sum = 0.0;
			for (int k = 0; k < STEPS; k++) {
				vec3 p = from + ray * (t0 + (float(k) + jitter) * step_length);
				vec3 local = p - lens;
				float along = dot(local, axis);
				if (along <= 0.0 || along >= beam_length) {
					continue;
				}
				float radius = spread * along;
				float edge = length(local - axis * along) / radius;
				if (edge >= 1.0) {
					continue;
				}
				float share = along / full;
				float soft = 1.0 - edge * edge;
				// Light spread over the beam's width: about as bright across it all along, fading out to its end.
				float fade = (1.0 - share) * (1.0 - share) * smoothstep(0.0, 0.06, share);
				float air = mix(1.0, 0.35 + 1.3 * noise(p * 1.8 + drift), haze);
				sum += soft * soft * fade * air / max(radius, 0.12);
			}
			glow = sum * step_length * on;
		}
	}
	ALBEDO = tint * glow * level;
	ALPHA = 1.0;
}
