// A wound's specks, stuck to a bone: round points of `UV.x` pixels, charred
// black or red (the vertex colour), red-black in the dark (stain_light).
shader_type spatial;
render_mode unshaded, blend_mix, cull_disabled, depth_draw_never, shadows_disabled;

#include "res://shaders/stain_light.gdshaderinc"

varying vec3 lit;

void vertex() {
	POINT_SIZE = UV.x;
	lit = stain_light((MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz);
}

void fragment() {
	vec2 c = POINT_COORD - 0.5;
	float d = dot(c, c) * 4.0;
	if (d > 1.0) {
		discard;
	}
	ALBEDO = COLOR.rgb * lit * (1.1 - d * 0.3);
	ALPHA = COLOR.a;
}
