class_name BladeTrail
extends MeshInstance3D
## The glowing arc a strike leaves behind (port of src/blade-trail.js): a
## ribbon in the world joining recent blade positions; between frames the
## blade is swept round its hilt, so fast cuts draw round arcs rather than
## straight chords. update(dt, base, tip, intensity 0..1).
##
## Vertex colours are stored in 8 bits, so they carry the glow divided by
## BRIGHTNESS and the shader (shaders/additive_trail.gdshader) gives it back.

const MAX := 48
const BRIGHTNESS := 3.0

var lifetime := 0.16
var subdivisions := 4
var glow := Color(0.1, 0.42, 1.9)
var core := Color(0.42, 1.05, 2.9)
var samples: Array[Dictionary] = []
var _last_base := Vector3.ZERO
var _last_direction := Vector3.UP
var _has_last := false
var _length := 0.0
var _mesh := ImmediateMesh.new()


func _ready() -> void:
	top_level = true
	# Its vertices are in the world's frame: the node itself stays at the origin, unturned.
	global_transform = Transform3D.IDENTITY
	mesh = _mesh
	cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	extra_cull_margin = 16384.0
	var material := ShaderMaterial.new()
	material.shader = load("res://shaders/additive_trail.gdshader")
	material.set_shader_parameter("brightness", BRIGHTNESS)
	material_override = material


func _push(base: Vector3, direction: Vector3, strength: float) -> void:
	samples.push_front({ "base": base, "dir": direction, "age": 0.0, "strength": strength })
	if samples.size() > MAX:
		samples.pop_back()


func update(dt: float, base: Vector3, tip: Vector3, intensity: float) -> void:
	for sample in samples:
		sample.age += dt
	while not samples.is_empty() and samples.back().age > lifetime:
		samples.pop_back()
	var direction := tip - base
	_length = direction.length()
	direction = direction.normalized()
	if intensity > 0.01 and _length > 0.05:
		if _has_last:
			# Sweep the blade around its hilt between the two frames.
			var turn := Quaternion(_last_direction, direction)
			for i in range(1, subdivisions):
				var s := float(i) / subdivisions
				_push(_last_base.lerp(base, s), Quaternion.IDENTITY.slerp(turn, s) * _last_direction, intensity)
				samples[0].age = dt * (1.0 - s)
		_push(base, direction, intensity)
		_last_base = base
		_last_direction = direction
		_has_last = true
	else:
		_has_last = false
	_mesh.clear_surfaces()
	visible = samples.size() > 1
	if not visible:
		return
	_mesh.surface_begin(Mesh.PRIMITIVE_TRIANGLE_STRIP)
	for sample in samples:
		var fade: float = pow(maxf(0.0, 1.0 - sample.age / lifetime), 1.6) * sample.strength / BRIGHTNESS
		# The arc is brightest along the outer half of the blade.
		_mesh.surface_set_color(Color(glow.r * fade * 0.25, glow.g * fade * 0.25, glow.b * fade * 0.25))
		_mesh.surface_add_vertex(sample.base + sample.dir * (_length * 0.22))
		_mesh.surface_set_color(Color(core.r * fade, core.g * fade, core.b * fade))
		_mesh.surface_add_vertex(sample.base + sample.dir * _length)
	_mesh.surface_end()


func clear() -> void:
	samples.clear()
	_has_last = false
	_mesh.clear_surfaces()
	visible = false
