// The light falling on the red stains (port of src/stain-light.js): drawn
// unlit in their own colour, which is right in the lit room; in the dark
// they go red-black, except where a lamp's beam or the blade's glow catches
// them. StainLight (scripts/fx/stain_light.gd) sets these on every stain
// material each frame: the room's light (1 → the stains as they are) and the
// lights near them.
uniform float stain_room = 1.0;
uniform float stain_floor = 0.08;
uniform float stain_scale = 0.0357;
uniform vec4 stain_a[12]; // where the light is, how far it reaches (0: no limit)
uniform vec4 stain_b[12]; // where it points, the cosine of its edge (−2: all round)
uniform vec4 stain_c[12]; // its colour × intensity, the cosine where its edge starts to soften
uniform float stain_decay[12];

vec3 stain_light(vec3 world) {
	if (stain_room >= 1.0) {
		return vec3(1.0);
	}
	vec3 sum = vec3(0.0);
	for (int i = 0; i < 12; i++) {
		vec3 to = world - stain_a[i].xyz;
		float d = max(length(to), 1e-3);
		float reach = stain_a[i].w > 0.0 ? pow(clamp(1.0 - pow(d / stain_a[i].w, 4.0), 0.0, 1.0), 2.0) : 1.0;
		float cone = stain_b[i].w < -1.5 ? 1.0 : smoothstep(stain_b[i].w, stain_c[i].w, dot(to / d, stain_b[i].xyz));
		sum += stain_c[i].rgb * reach * cone / max(pow(d, stain_decay[i]), 0.01);
	}
	// In the dark: a red-black floor, raised where a light falls; lit room: as they are.
	return mix(clamp(sum * stain_scale, vec3(stain_floor), vec3(1.2)), vec3(1.0), stain_room);
}
