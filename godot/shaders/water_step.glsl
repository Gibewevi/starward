#[compute]
#version 450

// The marsh's waves (src/water.js's simulate(), on the graphics card): the
// damped wave equation on a grid, the banks reflecting it; water heaped
// against a bank spills over it as a thin sheet that runs out over the mud
// and soaks away. Two passes a step: pass 0 applies this step's pushes
// (steps, wading, splashes, the Force's shoves, blasts) in place; pass 1
// works out the next state from the current one. Each cell: r its height,
// g its speed, b the sheet spilt over a dry cell.

layout(local_size_x = 8, local_size_y = 8, local_size_z = 1) in;

layout(rgba32f, set = 0, binding = 0) uniform restrict image2D current;
layout(rgba32f, set = 0, binding = 1) uniform restrict writeonly image2D next;
layout(r32f, set = 0, binding = 2) uniform restrict readonly image2D mask;
// Three vec4s a push. head: kind, x, z, radius (m).
// Kind 0, a push down (or up): amount. Kind 1, a blast's hole: depth.
// Kind 2, the Force's shove: dir x, dir z, cos(cone), power; then range, front.
layout(set = 0, binding = 3, std430) restrict readonly buffer Pushes {
	vec4 data[];
} pushes;

layout(push_constant, std430) uniform Params {
	ivec2 size;
	int pass_index;
	int count;
	vec2 origin;
	float cell;
	float pad;
} params;

const float K2 = 0.13;
const float DAMPING = 0.978;
const float SPILL = 0.016;

bool wet(ivec2 p) {
	return imageLoad(mask, p).r > 0.0;
}

int banks(ivec2 p) {
	return (wet(p + ivec2(-1, 0)) ? 0 : 1) + (wet(p + ivec2(1, 0)) ? 0 : 1) + (wet(p + ivec2(0, -1)) ? 0 : 1) + (wet(p + ivec2(0, 1)) ? 0 : 1);
}

// Pass 0: this step's pushes, each on the water cells it reaches.
void push_cell(ivec2 p) {
	if (!wet(p)) {
		return;
	}
	vec4 state = imageLoad(current, p);
	vec2 at = params.origin + (vec2(p) + 0.5) * params.cell;
	bool changed = false;
	for (int n = 0; n < params.count; n++) {
		vec4 head = pushes.data[n * 3];
		vec4 a = pushes.data[n * 3 + 1];
		vec4 b = pushes.data[n * 3 + 2];
		int kind = int(head.x + 0.5);
		vec2 d = at - head.yz;
		float l = length(d);
		if (kind == 0 || kind == 1) {
			float d2 = l / head.w;
			if (d2 > 1.0) {
				continue;
			}
			float shape = 1.0 - d2 * d2;
			if (kind == 0) {
				state.r -= a.x * shape;
			} else {
				// Blown out: a hole in the water, still for an instant.
				state.r -= a.x * shape;
				state.g = 0.0;
			}
			changed = true;
		} else {
			// A wall of water driven across the cone: heaped on the front's leading side, drawn down behind it.
			float range = b.x;
			float front = b.y;
			if (l < 0.05 || l > range || dot(d, a.xy) / l < a.z) {
				continue;
			}
			bool out_from = a.w > 0.0;
			float ahead = (l - front) * (out_from ? 1.0 : -1.0);
			if (ahead < -0.5 || ahead > 0.3) {
				continue;
			}
			float near = 1.0 - l / range;
			float ease = near * (2.0 - near);
			state.r += (ahead > 0.0 ? 0.022 : -0.012) * abs(a.w) * (0.25 + 0.75 * ease);
			changed = true;
		}
	}
	if (changed) {
		imageStore(current, p, state);
	}
}

// Pass 1: the next state.
void step_cell(ivec2 p) {
	vec4 state = imageLoad(current, p);
	if (wet(p)) {
		// Dry neighbours are the bank: the wave bounces off them.
		float c = state.r;
		float l = wet(p + ivec2(-1, 0)) ? imageLoad(current, p + ivec2(-1, 0)).r : c;
		float r = wet(p + ivec2(1, 0)) ? imageLoad(current, p + ivec2(1, 0)).r : c;
		float u = wet(p + ivec2(0, -1)) ? imageLoad(current, p + ivec2(0, -1)).r : c;
		float d = wet(p + ivec2(0, 1)) ? imageLoad(current, p + ivec2(0, 1)).r : c;
		float speed = (state.g + (l + r + u + d - 4.0 * c) * K2) * DAMPING;
		// Heaped against the bank: over it, onto the dry ground beside.
		if (c > SPILL && banks(p) > 0) {
			c -= (c - SPILL) * 0.5;
		}
		// The level comes back slowly: no water is lost to the pushes.
		imageStore(next, p, vec4((c + speed) * 0.99, speed, 0.0, 0.0));
		return;
	}
	// Dry: the sheet spilt from the water beside it, running out to the lower dry neighbours, soaking away.
	float f = state.b;
	float spilt = 0.0;
	float flow = 0.0;
	ivec2 around[4] = ivec2[4](ivec2(-1, 0), ivec2(1, 0), ivec2(0, -1), ivec2(0, 1));
	for (int k = 0; k < 4; k++) {
		ivec2 q = p + around[k];
		if (wet(q)) {
			float h = imageLoad(current, q).r;
			int count = banks(q);
			if (h > SPILL && count > 0) {
				spilt += (h - SPILL) * 0.5 * 3.0 / float(count);
			}
			continue;
		}
		float g = imageLoad(current, q).b;
		if (g < f && f >= 1e-5) {
			flow -= (f - g) * 0.1;
		} else if (g > f && g >= 1e-5) {
			flow += (g - f) * 0.1;
		}
	}
	float sheet = max(0.0, (f + flow) * 0.996 - 0.000006) + spilt;
	imageStore(next, p, vec4(state.r * 0.99, 0.0, sheet, 0.0));
}

void main() {
	ivec2 p = ivec2(gl_GlobalInvocationID.xy);
	if (p.x < 1 || p.y < 1 || p.x >= params.size.x - 1 || p.y >= params.size.y - 1) {
		return;
	}
	if (params.pass_index == 0) {
		push_cell(p);
	} else {
		step_cell(p);
	}
}
