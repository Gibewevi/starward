// The pool spreading from under the hero: an uneven disc, darker at its heart
// (UV.x: 0 at the centre, 1 on the rim), its edge soft; red-black in the dark.
shader_type spatial;
render_mode unshaded, blend_mix, cull_disabled, depth_draw_never, shadows_disabled;

#include "res://shaders/stain_light.gdshaderinc"

uniform vec3 tint = vec3(0.36, 0.014, 0.011);

varying vec3 lit;

void vertex() {
	lit = stain_light((MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz);
}

void fragment() {
	float rim = UV.x;
	ALBEDO = tint * (0.75 + 0.35 * rim) * lit;
	ALPHA = 0.92 * smoothstep(1.0, 0.82, rim);
}
