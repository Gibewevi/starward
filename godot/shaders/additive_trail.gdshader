// Glowing ribbons added onto the scene (the blade's trail): unlit, both faces,
// no depth written; the vertex colours carry the glow divided by `brightness`
// (they are stored in 8 bits), given back here so it blooms.
shader_type spatial;
render_mode unshaded, blend_add, cull_disabled, depth_draw_never, shadows_disabled;

uniform float brightness = 3.0;

void fragment() {
	ALBEDO = COLOR.rgb * brightness;
}
