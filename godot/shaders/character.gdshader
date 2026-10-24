// The characters' light grade (shaders/character_light.gdshaderinc); colours
// from the vertices, tinted by the baked material's colour.
shader_type spatial;
render_mode diffuse_lambert, specular_disabled;

uniform vec4 tint : source_color = vec4(1.0);
uniform bool use_vertex_colour = true;

#include "res://shaders/character_light.gdshaderinc"

void fragment() {
	ALBEDO = tint.rgb * (use_vertex_colour ? COLOR.rgb : vec3(1.0));
}
