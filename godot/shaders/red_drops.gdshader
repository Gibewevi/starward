// Red drops: opaque round points of `UV.x` pixels (not added light), a touch
// lighter at their top; the vertex colour's alpha fades them out. In the
// dark they take only the light that falls on them (stain_light).
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
	ALBEDO = COLOR.rgb * lit * (1.15 - d * 0.35 - c.y * 0.3);
	ALPHA = COLOR.a;
}
