class_name Transformer
extends Node3D
## The power transformer in a corner of the room — the room's lights hang on
## it (port of src/transformer.js; its tank, fins, insulators and arc window
## come baked in lab.glb). The hero can run his blade into the arc window
## (begin()). The surge then builds for FEEL.sabotage.surge seconds — sparks
## pouring out round the blade, arcs leaping between the insulators and to
## the blade, its own light stuttering brighter and brighter, the lamps gone
## red — until it bursts. Dead, it smoulders, and now and then spits sparks
## and an arc into the dark.
##
## update(dt, blade) returns what happened this frame: { progress (0 → 1
## while surging), burst (the moment it blows), spit (a crackle in the dark) }.

const ARCS := 5
const SEGMENTS := 9
const WIDTH := 1.3
const DEPTH := 1.05

var feel: Dictionary
var effects: ImpactEffects
var random: Callable
## The arc window's middle, the way it faces, the spot to stand at, the insulators' tops.
var socket := Vector3.ZERO
var facing := Vector3(0, 0, 1)
var across := Vector3(1, 0, 0)
var approach := Vector3.ZERO
var tops: Array[Vector3] = []
var model: Node3D
var state := "ready"
var _slot: StandardMaterial3D
var _slot_base := Color(0.55, 0.8, 1.5)
var _lamps: Array[StandardMaterial3D] = []
var _light: OmniLight3D
var _halo: MeshInstance3D
var _arcs: MeshInstance3D
var _arc_points := PackedVector3Array()
var _arcs_changed := false
var _clock := 0.0
var _arc_clock := 0.0
var _spray_clock := 0.0
var _spit_clock := 0.0
var _flare := 0.0
var _time := 0.0


## `room`: the baked lab (its "Transformer" node), `data`: lab.json's transformer (socket, approach, facing).
func _init(room: Node, data: Dictionary, feel_data: Dictionary, fx: ImpactEffects, draw: Callable = Callable()) -> void:
	name = "Transformer"
	feel = feel_data
	effects = fx
	random = draw if draw.is_valid() else func() -> float: return randf()
	socket = Obstacles._vector(data.socket)
	facing = Obstacles._vector(data.facing)
	facing.y = 0.0
	facing = facing.normalized()
	across = Vector3(facing.z, 0, -facing.x)
	approach = Obstacles._vector(data.approach)
	# Its frame: the socket sits at (0.12, 0.98, DEPTH / 2 − 0.05) in it.
	var at := socket - across * 0.12 - Vector3.UP * 0.98 - facing * (DEPTH / 2.0 - 0.05)
	for x in [-0.38, 0.0, 0.38]:
		tops.append(at + across * x + Vector3.UP * 1.88 - facing * 0.15)
	model = room.find_child("Transformer", true, false)
	if model:
		for mesh: MeshInstance3D in model.find_children("*", "MeshInstance3D", true, false):
			var material := mesh.mesh.surface_get_material(0) as StandardMaterial3D
			if material == null:
				continue
			if material.resource_name == "arc window":
				_slot = material.duplicate()
				_slot_base = _slot.albedo_color
				mesh.material_override = _slot
			elif material.resource_name == "transformer lamp":
				var lamp: StandardMaterial3D = material.duplicate()
				mesh.material_override = lamp
				_lamps.append(lamp)
		for light: OmniLight3D in model.find_children("*", "OmniLight3D", true, false):
			_light = light
	# The arc window's glow before it.
	_halo = ImpactEffects.glow_quad(self, "Arc window glow")
	_halo.position = socket + facing * 0.05
	_halo.visible = true
	# Arcs: jagged blue-white lines, rebuilt every few hundredths of a second.
	_arcs = MeshInstance3D.new()
	_arcs.name = "Arcs"
	_arcs.mesh = ArrayMesh.new()
	_arcs.extra_cull_margin = 16.0
	_arcs.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var material := StandardMaterial3D.new()
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	material.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	material.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	material.albedo_color = Color(1.6, 2.2, 3.2, 1)
	_arcs.material_override = material
	add_child(_arcs)
	_arc_points.resize(ARCS * SEGMENTS * 2)
	reset()


## Can the hero standing at `position` run his blade into it?
func reachable(position: Vector3) -> bool:
	return state == "ready" and Vector2(position.x - approach.x, position.z - approach.z).length() < feel.sabotage.reach


## A jagged bolt from a to b in slot i.
func _bolt(i: int, a: Vector3, b: Vector3, jag: float = 0.12) -> void:
	var previous := a
	for s in range(1, SEGMENTS + 1):
		var k := float(s) / SEGMENTS
		var next := b
		if s < SEGMENTS:
			var x: float = random.call() - 0.5
			var y: float = random.call() - 0.5
			next = a.lerp(b, k) + Vector3(x, y, random.call() - 0.5) * (jag * 2.0 * sin(PI * k))
		_arc_points[(i * SEGMENTS + s - 1) * 2] = previous
		_arc_points[(i * SEGMENTS + s - 1) * 2 + 1] = next
		previous = next
	_arcs_changed = true


func _hide_bolt(i: int) -> void:
	for k in range(i * SEGMENTS * 2, (i + 1) * SEGMENTS * 2):
		_arc_points[k] = Vector3.ZERO
	_arcs_changed = true


func _draw_arcs() -> void:
	if not _arcs_changed:
		return
	_arcs_changed = false
	var mesh: ArrayMesh = _arcs.mesh
	mesh.clear_surfaces()
	var lines := PackedVector3Array()
	for k in range(0, _arc_points.size(), 2):
		if _arc_points[k] != _arc_points[k + 1]:
			lines.append(_arc_points[k])
			lines.append(_arc_points[k + 1])
	if lines.is_empty():
		return
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = lines
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_LINES, arrays)


func _set_slot(colour: Color) -> void:
	if _slot:
		_slot.albedo_color = colour


func _set_halo(opacity: float, size: float) -> void:
	_halo.scale = Vector3.ONE * size
	_halo.material_override.set_shader_parameter("tint", Color(0.35, 0.55, 1.1, clampf(opacity, 0.0, 1.0)))


func _set_light(intensity: float) -> void:
	if _light:
		_light.light_energy = intensity * LabLevel.LIGHT_SCALE


func _light_intensity() -> float:
	return _light.light_energy / LabLevel.LIGHT_SCALE if _light else 0.0


func begin() -> bool:
	if state != "ready":
		return false
	state = "surging"
	_clock = 0.0
	return true


## `blade`: [base, tip] this frame while it is in (the arcs jump to it), or empty.
func update(dt: float, blade: Array = []) -> Dictionary:
	_time += dt
	var result := { "progress": 0.0, "burst": false, "spit": false }
	var s: Dictionary = feel.sabotage
	_flare = maxf(0.0, _flare - dt * 3.0)
	if state == "ready":
		# Alive: the window crackles softly, the lamps blink green, a faint arc between the insulators now and then.
		var crackle := 0.85 + 0.15 * sin(_time * 37.0) * sin(_time * 23.0)
		_set_slot(_slot_base * crackle)
		for i in _lamps.size():
			_lamps[i].albedo_color = Color(0.1, 0.7, 0.2) * (1.0 if sin(_time * 2.1 + i * 2.0) > -0.3 else 0.15)
		_set_light(0.8 * crackle)
		_set_halo(0.5 * crackle, 0.7)
		_arc_clock -= dt
		if _arc_clock <= 0.0:
			_arc_clock = 0.05
			if random.call() < 0.08:
				_bolt(0, tops[floori(random.call() * 2.0)], tops[1 + floori(random.call() * 2.0)], 0.06)
			else:
				_hide_bolt(0)
			for i in range(1, ARCS):
				_hide_bolt(i)
	elif state == "surging":
		_clock += dt
		var k := minf(1.0, _clock / float(s.surge))
		result.progress = k
		# Sparks pour out round the blade, more and more.
		_spray_clock -= dt
		if _spray_clock <= 0.0:
			_spray_clock = 0.07 - 0.04 * k
			var x: float = (random.call() - 0.5) * 1.2
			var y: float = 0.4 + random.call() * 0.6
			var spray := (facing + Vector3(x, y, (random.call() - 0.5) * 1.2)).normalized()
			effects.sparks(socket + facing * 0.05, spray, across, { "count": roundi(5.0 + 14.0 * k), "speed": 2.5 + 3.0 * k, "saber": 0.55 })
		# The window and the light stutter, brighter and brighter; the lamps turn red and race.
		var stutter := 0.25 if random.call() < 0.25 + 0.4 * k else 1.0
		_set_slot(_slot_base * ((1.2 + 2.5 * k) * stutter))
		_set_light((3.0 + 14.0 * k) * stutter)
		_set_halo(minf(1.0, 0.6 + k) * stutter, 0.7 + 0.9 * k)
		for i in _lamps.size():
			_lamps[i].albedo_color = Color(0.9, 0.05, 0.02) * (1.0 if sin(_time * (12.0 + 20.0 * k) + i * 1.7) > 0.0 else 0.1)
		# Arcs: between the insulators, and down to the blade.
		_arc_clock -= dt
		if _arc_clock <= 0.0:
			_arc_clock = 0.035 + random.call() * 0.03
			for i in ARCS:
				if random.call() > 0.35 + 0.6 * k:
					_hide_bolt(i)
					continue
				var from: int = floori(random.call() * 3.0)
				var to: Vector3
				var same := false
				if i < 2 and not blade.is_empty():
					to = (blade[0] as Vector3).lerp(blade[1], 0.15 + random.call() * 0.5)
				elif i < 4:
					var other: int = floori(random.call() * 3.0)
					same = other == from
					to = tops[other]
				else:
					to = socket
				if same:
					_hide_bolt(i)
					continue
				_bolt(i, tops[from], to, 0.1 + 0.12 * k)
		_arcs.material_override.albedo_color.a = 0.8 + 0.2 * random.call()
		if k >= 1.0:
			# It blows.
			state = "dead"
			_clock = 0.0
			result.burst = true
			_flare = 1.0
			_set_slot(Color(0.02, 0.025, 0.03))
			for lamp in _lamps:
				lamp.albedo_color = Color(0, 0, 0)
			_set_light(40.0)
			_set_halo(1.0, 2.4)
			for i in ARCS:
				var x: float = (random.call() - 0.5) * 1.6
				var y: float = random.call() * 1.2 - 0.6
				_bolt(i, tops[i % 3], socket + across * x + Vector3.UP * y + facing * (0.6 + random.call()), 0.3)
			_spit_clock = Feel.pick(s.spit)
	else:
		# Dead: smouldering in the dark; now and then a spit of sparks and an arc, lighting the corner for an instant.
		_clock += dt
		_set_light(maxf(0.0, _light_intensity() * exp(-dt * 9.0)) + _flare * 6.0)
		_set_halo(minf(1.0, _flare * 1.2), 0.6 + _flare * 1.6)
		_arcs.material_override.albedo_color.a = minf(1.0, _flare * 1.5)
		if _flare <= 0.05:
			for i in ARCS:
				_hide_bolt(i)
		_spit_clock -= dt
		if _spit_clock <= 0.0:
			_spit_clock = Feel.pick(s.spit) * (2.5 if _clock > s.calm else 1.0)
			_flare = 0.6 + random.call() * 0.5
			result.spit = true
			var x: float = random.call() - 0.5
			var y: float = 0.3 + random.call() * 0.5
			var spray := (facing + Vector3(x, y, random.call() - 0.5)).normalized()
			effects.sparks(socket + facing * 0.05, spray, across, { "count": 8 + roundi(random.call() * 14.0), "speed": 3.0, "saber": 0.5 })
			for i in 2:
				var from: int = floori(random.call() * 3.0)
				var ox: float = (random.call() - 0.5) * 0.8
				_bolt(i, tops[from], socket + across * ox + Vector3.UP * (random.call() * 0.5) + facing * 0.2, 0.15)
	_draw_arcs()
	return result


func reset() -> void:
	state = "ready"
	_clock = 0.0
	_flare = 0.0
	_set_slot(_slot_base)
	_set_halo(0.5, 0.7)
	_set_light(0.8)
	_arc_points.fill(Vector3.ZERO)
	_arcs_changed = true
	_draw_arcs()
