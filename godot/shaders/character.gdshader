// The characters' light grade (port of src/character-shading.js). The lab's
// key, rim and sky light are cold; on the Jedi they are read as a warm
// neutral, so the browns of the reference stay brown. Point lights — the
// blade's glow — keep their colour, softened, and still tint the coat blue on
// the sword side. Lambert, no highlights; colours from the vertices.
shader_type spatial;
render_mode diffuse_lambert, specular_disabled;

uniform vec4 tint : source_color = vec4(1.0);
uniform bool use_vertex_colour = true;

vec3 character_grade(vec3 light) {
	float luminance = dot(light, vec3(0.2126, 0.7152, 0.0722));
	return mix(vec3(luminance), light, 0.35) * vec3(1.16, 0.97, 0.78);
}

void fragment() {
	ALBEDO = tint.rgb * (use_vertex_colour ? COLOR.rgb : vec3(1.0));
}

void light() {
	vec3 lit = LIGHT_COLOR * ATTENUATION * max(dot(NORMAL, LIGHT), 0.0) / PI;
	DIFFUSE_LIGHT += LIGHT_IS_DIRECTIONAL ? character_grade(lit) : lit * 0.55;
}
