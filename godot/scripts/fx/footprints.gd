class_name Footprints
extends Node3D
## Red footprints (port of src/footprints.js). A foot that came down in red
## drops prints its sole on the next steps — strong at first, fainter each
## step — so the hero's tracks and the troopers' can be followed across the
## deck. Every print is one instance of a single MultiMesh (one draw call for
## all of them): a boot sole painted in a small texture (tread, a gap, the
## heel), mirrored for the left foot, laid on the floor along the foot, dark
## red, fading after half a minute. In the dark they go red-black, but for
## where a lamp or the blade lights them (StainLight).
##
## stamp(at, along, side, strength, [length, width]) — `along`: heel to toe on
## the floor; side "L" or "R"; strength 0 → 1. Then update(dt).
##
## Options make other prints of the same sole: `tint`, how long they `linger`
## ([min, max] s), `name` — the soles pressed into the jungle's sand, dark and lasting.

var feel: Dictionary
var random: Callable
var _multimesh: MultiMesh
var _material: ShaderMaterial
var _age := PackedFloat32Array()
var _life := PackedFloat32Array()
var _strength := PackedFloat32Array()
var _next := 0
var _used := 0
var _linger: Variant = null


func _init(feel_data: Dictionary, count: int = 360, draw: Callable = Callable(), options: Dictionary = {}) -> void:
	name = options.get("name", "Red footprints")
	feel = feel_data
	_linger = options.get("linger")
	random = draw if draw.is_valid() else func() -> float: return randf()
	# Flat on the floor, heel at −Z, toe at +Z (the texture runs heel → toe).
	var plane := PlaneMesh.new()
	plane.size = Vector2(1, 1)
	_material = ShaderMaterial.new()
	_material.shader = load("res://shaders/footprints.gdshader")
	_material.set_shader_parameter("map", sole_texture())
	if options.has("tint"):
		var tint: Color = options.tint
		_material.set_shader_parameter("tint", Vector3(tint.r, tint.g, tint.b))
	_material.render_priority = 1
	StainLight.register(_material, feel)
	_multimesh = MultiMesh.new()
	_multimesh.transform_format = MultiMesh.TRANSFORM_3D
	_multimesh.use_colors = true
	_multimesh.mesh = plane
	_multimesh.instance_count = count
	_multimesh.visible_instance_count = 0
	var instance := MultiMeshInstance3D.new()
	instance.name = "Prints"
	instance.multimesh = _multimesh
	instance.material_override = _material
	instance.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	instance.extra_cull_margin = 64.0
	add_child(instance)
	for array in [_age, _life, _strength]:
		array.resize(count)
		array.fill(0.0)


func _exit_tree() -> void:
	StainLight.forget(_material)


## The boot sole: wider at the ball, narrower at the waist, round at both
## ends, the heel apart; crossbars of tread and a speckle where it pressed
## less. Laid on a PlaneMesh as the web lays it: the heel towards −Z, the
## web's u running towards −X.
static func sole_texture() -> ImageTexture:
	var w := 32
	var h := 64
	var image := Image.create(w, h, false, Image.FORMAT_RGBA8)
	# A deterministic grain for the tread, so every print is the same boot.
	var seed := 7
	var noise := PackedFloat32Array()
	for k in w * h:
		seed = (seed * 16807) % 2147483647
		noise.append(seed / 2147483647.0)
	for y in h:
		for x in w:
			var u := (x + 0.5) / w * 2.0 - 1.0
			var v := (y + 0.5) / h  # heel (0) → toe (1)
			var inside := 0.0
			if v > 0.38:
				var t := (v - 0.38) / 0.62
				var half := 0.72 + 0.22 * sin(PI * minf(1.0, t * 1.25)) - 0.1 * t
				var tip := sqrt(maxf(0.0, 1.0 - pow((v - 0.86) / 0.14, 2.0))) if v > 0.86 else 1.0
				inside = 1.0 if absf(u + 0.06 * t) < half * tip else 0.0
			elif v > 0.04 and v < 0.3:
				var round_end := sqrt(maxf(0.0, 1.0 - pow((0.1 - v) / 0.06, 2.0))) if v < 0.1 else 1.0
				inside = 1.0 if absf(u) < 0.66 * round_end else 0.0
			var bar := 0.45 if absf(sin(v * 46.0)) > 0.82 else 1.0
			var speck := 0.5 if noise[y * w + x] < 0.18 else 1.0
			image.set_pixel(w - 1 - x, y, Color8(255, 255, 255, roundi(255.0 * inside * bar * speck)))
	var texture := ImageTexture.create_from_image(image)
	return texture


## A sole printed at `at` (on the floor), heel to toe along `along`; `size` is [length, width].
func stamp(at: Vector3, along: Vector3, side: String, amount: float, size: Array = []) -> int:
	if size.is_empty():
		size = feel.prints.hero
	var i := _next
	_next = (_next + 1) % _multimesh.instance_count
	_used = maxi(_used, _multimesh.instance_count if _next == 0 else _next)
	_multimesh.visible_instance_count = _used
	# The left sole is the right one mirrored; a print is never quite the same size twice.
	var jitter: float = 0.94 + random.call() * 0.12
	var turn := Basis(Vector3.UP, atan2(along.x, along.z))
	var scale := Vector3(float(size[1]) * jitter * (-1.0 if side == "L" else 1.0), 1, float(size[0]) * jitter)
	_multimesh.set_instance_transform(i, Transform3D(turn * Basis.from_scale(scale), Vector3(at.x, 0.004, at.z)))
	_age[i] = 0.0
	_life[i] = Feel.pick(_linger if _linger != null else feel.prints.linger)
	_strength[i] = minf(1.0, amount)
	_multimesh.set_instance_color(i, Color(1, 1, 1, minf(1.0, 0.35 + _strength[i])))
	return i


func update(dt: float) -> void:
	var out: float = feel.prints.fade
	for i in _used:
		if _strength[i] <= 0.0:
			continue
		_age[i] += dt
		var left := clampf((_life[i] + out - _age[i]) / out, 0.0, 1.0)
		if left <= 0.0:
			_strength[i] = 0.0
		# A sole half dry still prints clearly; a nearly dry one only faintly.
		_multimesh.set_instance_color(i, Color(1, 1, 1, minf(1.0, 0.35 + _strength[i]) * left))


func clear() -> void:
	_age.fill(0.0)
	_life.fill(0.0)
	_strength.fill(0.0)
	_next = 0
	_used = 0
	_multimesh.visible_instance_count = 0


## Prints still showing.
func count() -> int:
	var total := 0
	for i in _used:
		if _strength[i] > 0.0:
			total += 1
	return total
