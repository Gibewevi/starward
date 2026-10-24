// Red footprints: the boot sole's texture, dark red, faded per print (the
// instance colour's alpha); red-black in the dark (stain_light).
shader_type spatial;
render_mode unshaded, blend_mix, cull_disabled, depth_draw_never, shadows_disabled;

#include "res://shaders/stain_light.gdshaderinc"

uniform sampler2D map : filter_nearest;
uniform vec3 tint = vec3(0.5, 0.024, 0.017);

varying vec3 lit;
varying float fade;

void vertex() {
	fade = COLOR.a;
	lit = stain_light((MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz);
}

void fragment() {
	float a = texture(map, UV).a * fade;
	if (a < 0.02) {
		discard;
	}
	ALBEDO = tint * lit;
	ALPHA = a;
}
