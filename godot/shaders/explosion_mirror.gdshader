// The fire mirrored in the wet metal floor: from each floor point, the
// mirror ray traced up to the flipbook's plane (facing the camera, through
// `centre`); and the pool of light the flash throws around the blast.
shader_type spatial;
render_mode unshaded, blend_add, cull_disabled, depth_draw_never, shadows_disabled;

#include "res://shaders/explosion_flipbook.gdshaderinc"

uniform vec3 centre;
uniform float width = 7.8;
uniform float strength = 1.0;
uniform float flash = 0.0;
uniform vec3 light_color = vec3(1.0, 0.5, 0.18);
uniform float time = 0.0;

varying vec3 world;

void vertex() {
	world = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec3 right = INV_VIEW_MATRIX[0].xyz;
	vec3 up = INV_VIEW_MATRIX[1].xyz;
	vec3 view = -INV_VIEW_MATRIX[2].xyz;
	vec3 mirrored = vec3(view.x, -view.y, view.z);
	float denominator = dot(mirrored, -view);
	if (abs(denominator) < 0.001) {
		discard;
	}
	float t = dot(centre - world, -view) / denominator;
	vec3 hit = world + mirrored * t - centre;
	vec2 uv = vec2(dot(hit, right) / width + 0.5, 0.5 - dot(hit, up) / width);
	// Brushed, wet metal: the reflection wavers and streaks.
	vec2 ripple = vec2(value_noise(world.xz * 2.6 + time * 0.3), value_noise(world.xz * 2.6 + 17.0 - time * 0.2)) - 0.5;
	uv += ripple * vec2(0.012, -0.035);
	vec4 c = t > 0.0 ? flipbook(uv) : vec4(0.0);
	float heat = heat_of(c, uv);
	float grain = 0.7 + 0.3 * value_noise(world.xz * vec2(23.0, 3.0));
	vec3 mirror = c.rgb * vec3(1.0, 0.62, 0.25) * c.a * (0.025 + heat * 1.8) * grain;
	float reach = length(world.xz - centre.xz);
	float fade = 1.0 - smoothstep(width * 0.1, width * 0.7, reach);
	vec3 pool = light_color * flash * exp(-reach * reach / (width * width * 0.06));
	ALBEDO = (mirror * fade + pool) * strength;
	ALPHA = 1.0;
}
