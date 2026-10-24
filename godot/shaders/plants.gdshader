// The jungle's plants (src/vegetation.js's sway): everything moves here. The
// wind sways each plant on its own (a phase of its own, slow waves running
// across the ground, gusts), the tip more than the base (UV.x: how much a
// vertex sways); whoever goes through bends it away (`push`); an explosion
// throws everything outward with its front as it runs out, then the plants
// rock back; the Force sweeps them (`gust_a`, `gust_b`). A cut plant
// (INSTANCE_CUSTOM.y) is only a stub; torn up, nothing. Lit like the rest, a
// little glossy, each plant its own shade (the instance colour).
shader_type spatial;
render_mode cull_disabled;

uniform float u_time = 0.0;
uniform vec2 u_wind = vec2(0.12, 0.06);
uniform vec4 u_push[8];
uniform vec4 u_blast[4];
uniform float u_blast_radius[4];
uniform vec4 u_gust_a[2];
uniform vec4 u_gust_b[2];

void vertex() {
	float phase = INSTANCE_CUSTOM.x;
	float cut = INSTANCE_CUSTOM.y;
	// Cut: what was above the blade is gone, a stub stays; torn up by a blast, nothing.
	VERTEX.y = min(VERTEX.y, cut);
	if (cut < 0.01) {
		VERTEX = vec3(0.0);
	}
	float bend = UV.x * clamp(cut * 1.4, 0.0, 1.0);
	vec3 root = MODEL_MATRIX[3].xyz;
	float height = length(MODEL_MATRIX[1].xyz);
	float time = u_time;
	// The wind: slow waves across the ground, each plant its own phase, a quicker flutter on top.
	float wave = sin(time * 1.25 + phase + root.x * 0.33 + root.z * 0.21) * 0.6 + sin(time * 2.9 + phase * 2.3 + root.z * 0.5) * 0.25;
	vec2 offset = u_wind * (0.45 + wave) + vec2(sin(time * 4.7 + phase * 5.1), cos(time * 4.1 + phase * 3.7)) * 0.025;
	// Whoever goes through bends it away.
	for (int i = 0; i < 8; i++) {
		vec2 d = root.xz - u_push[i].xy;
		float l = length(d);
		if (u_push[i].z > 0.0 && l < u_push[i].z) {
			offset += d / max(l, 0.05) * (1.0 - l / u_push[i].z) * u_push[i].w;
		}
	}
	// An explosion: the front runs out, everything thrown with it, then rocking back.
	for (int i = 0; i < 4; i++) {
		float age = time - u_blast[i].z;
		if (u_blast[i].w <= 0.0 || age < 0.0 || age > 3.5) {
			continue;
		}
		vec2 d = root.xz - u_blast[i].xy;
		float l = max(length(d), 0.05);
		float reach = u_blast_radius[i];
		if (l > reach) {
			continue;
		}
		float near = 1.0 - l / reach;
		float ease = near * near * (3.0 - 2.0 * near);
		float front = age * 11.0;
		float hit = exp(-pow((l - front) / 1.2, 2.0)) * u_blast[i].w * ease;
		float rock = step(l, front) * exp(-age * 1.8) * sin(age * 9.0 - l * 0.6) * 0.45 * u_blast[i].w * ease;
		offset += d / l * (hit + rock);
	}
	// The Force: a wave through the cone before the hero — out from him, or in from the far end.
	for (int i = 0; i < 2; i++) {
		float age = time - u_gust_b[i].x;
		float power = u_gust_b[i].y;
		float reach = u_gust_b[i].z;
		if (power == 0.0 || age < 0.0 || age > 2.0) {
			continue;
		}
		vec2 d = root.xz - u_gust_a[i].xy;
		float l = max(length(d), 0.05);
		float aim = dot(d / l, u_gust_a[i].zw);
		if (l > reach || aim < u_gust_b[i].w) {
			continue;
		}
		float near = 1.0 - l / reach;
		float ease = near * (2.0 - near) * smoothstep(u_gust_b[i].w, mix(u_gust_b[i].w, 1.0, 0.4), aim);
		float front = power > 0.0 ? age * 16.0 : reach - age * 16.0;
		float passed = power > 0.0 ? step(l, front) : step(front, l);
		float hit = exp(-pow((l - front) / 1.1, 2.0)) + passed * exp(-age * 2.6) * cos(age * 10.0 - l) * 0.3;
		offset += normalize(d / l + u_gust_a[i].zw) * power * hit * ease;
	}
	// Metres at the tip, as far as the plant is tall; kept to a sane lean, the plant shortened as it leans.
	offset = offset * bend * height;
	float lean = length(offset);
	if (lean > height * 0.9) {
		offset *= height * 0.9 / lean;
	}
	vec3 world = vec3(offset.x, -dot(offset, offset) / max(height, 0.1) * 0.5 * bend, offset.y);
	// Back into the plant's own space: its matrix is a turn and a scale.
	mat3 turn = mat3(MODEL_MATRIX);
	VERTEX += vec3(dot(turn[0], world) / dot(turn[0], turn[0]), dot(turn[1], world) / dot(turn[1], turn[1]), dot(turn[2], world) / dot(turn[2], turn[2]));
}

void fragment() {
	ALBEDO = COLOR.rgb;
	ROUGHNESS = 0.86;
	if (!FRONT_FACING) {
		NORMAL = -NORMAL;
	}
}
