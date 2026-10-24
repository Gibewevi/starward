// The simulated coat skirt: the characters' light grade on its vertex
// colours, both faces drawn, the inside a darker lining.
shader_type spatial;
render_mode diffuse_lambert, specular_disabled, cull_disabled;

uniform vec3 inside = vec3(0.5, 0.46, 0.5);

#include "res://shaders/character_light.gdshaderinc"

void fragment() {
	ALBEDO = COLOR.rgb * (FRONT_FACING ? vec3(1.0) : inside);
}
