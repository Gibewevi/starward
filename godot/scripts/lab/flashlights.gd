class_name Flashlights
extends Node3D
## Lamps under the troopers' rifle barrels, for the dark (port of
## src/flashlights.js). Once the power is cut each trooper switches his on
## after a moment (a click, a stutter, then steady), and it goes where his
## rifle goes: sweeping the room as he looks for the hero, onto the hero as
## he aims, and on the floor by a dead man. A dead man's lamp stays on where
## it fell for a few seconds, then flickers — fewer and dimmer flashes, as a
## dying battery — and goes out for good. A man already dead when the power
## goes never switches his on.
##
## The light is a warm white, wide and soft-edged, with a little glow round
## the lens that lights the man himself and what stands near him. Every
## rifle shows its beam in the dusty air (shaders/lamp_beam.gdshader, the
## web's beam pass worked out beam by beam), up to the floor or whatever
## stands in the way.
##
## The dust hangs in the room's air, drifting and twirling slowly where it
## is; a beam only reveals it. A lamp sweeping the room lights new motes as
## it goes and leaves the others in the dark — it never carries its own. The
## hero or his blade going through pushes the dust aside and whirls it.
##
## The light itself comes from a small fixed pool of spot lights (each with
## its spill) handed each frame to the rifles nearest the hero.
##
## update(dt, troopers, hero, night, stirs) returns the troopers who switched
## their lamp on this frame. `stirs`: points moving through the air ({ at,
## speed }) that stir the dust.

const LENS := Vector3(0, -0.035, 0.36)
const BEAMS := 16

var feel: Dictionary
var obstacles: Obstacles
var random: Callable
## The spot lights and their spills (for the stains' light too).
var pool: Array[SpotLight3D] = []
var spills: Array[OmniLight3D] = []
## This frame's beams, nearest the hero first: { lens, forward, length, on }.
var volumes: Array = []
var _blackout: Dictionary
var _warmth: Color
var _beams := {}
var _beam_meshes: Array[MeshInstance3D] = []
var _glint_map: Texture2D
var _clock := 0.0
var _time := 0.0
# Dust: each mote's anchor (where it hangs), its wander rates, phase, twirl, orbit, size, drift.
var _room := {}
var _span := Vector3.ZERO
var _anchor := PackedVector3Array()
var _wander := PackedVector3Array()
var _phase := PackedFloat32Array()
var _swirl := PackedFloat32Array()
var _orbit := PackedFloat32Array()
var _size := PackedFloat32Array()
var _drift := PackedVector3Array()
var _cell := PackedInt32Array()
var _cells: Array = []
var _columns := 0
var _rows := 0
var _moving := {}
var _seen_at := PackedInt32Array()
var _glow_of := PackedFloat32Array()
var _placed := PackedVector3Array()
var _frame := 0
var _dust: MeshInstance3D
var _shown := 0


func _init(feel_data: Dictionary, level: Obstacles, bounds: Dictionary, draw: Callable = Callable()) -> void:
	name = "Rifle lamps"
	feel = feel_data
	obstacles = level
	random = draw if draw.is_valid() else func() -> float: return randf()
	_blackout = feel.blackout
	var lamp: Dictionary = _blackout.lamp
	_warmth = Color.hex(int(lamp.color) << 8 | 0xff)
	for index in int(_blackout.lamps):
		var light := SpotLight3D.new()
		light.name = "Rifle lamp"
		light.light_color = _warmth
		light.light_energy = 0.0
		light.spot_range = lamp.distance
		light.spot_angle = rad_to_deg(lamp.angle)
		light.spot_angle_attenuation = 0.35
		light.spot_attenuation = lamp.decay
		light.shadow_enabled = index < int(_blackout.shadows)
		light.shadow_bias = 0.03
		light.set_meta("penumbra", float(lamp.penumbra))
		add_child(light)
		pool.append(light)
		# The glow round the lens: the man holding it and what is right by him.
		var spill := OmniLight3D.new()
		spill.name = "Rifle lamp spill"
		spill.light_color = _warmth
		spill.light_energy = 0.0
		spill.omni_range = lamp.spillDistance
		spill.omni_attenuation = 2.0
		add_child(spill)
		spills.append(spill)
	_glint_map = ImpactEffects.glow_texture()
	var B: Dictionary = _blackout.beam
	var box := BoxMesh.new()
	box.size = Vector3.ONE
	var beam_shader: Shader = load("res://shaders/lamp_beam.gdshader")
	for k in BEAMS:
		var mesh := MeshInstance3D.new()
		mesh.name = "Lamp beam"
		mesh.mesh = box
		mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		var material := ShaderMaterial.new()
		material.shader = beam_shader
		material.set_shader_parameter("tint", Vector3(_warmth.r, _warmth.g, _warmth.b))
		material.set_shader_parameter("level", float(B.level))
		material.set_shader_parameter("spread", float(B.radius) / float(B.length))
		material.set_shader_parameter("full", float(B.length))
		material.set_shader_parameter("haze", float(B.haze))
		mesh.material_override = material
		mesh.visible = false
		add_child(mesh)
		_beam_meshes.append(mesh)
	_make_dust(bounds)


## Dust: motes hanging in the room's air (a little past its edges, where the beams reach over the railing).
func _make_dust(bounds: Dictionary) -> void:
	var D: Dictionary = _blackout.dust
	_room = { "minX": bounds.minX - 1.5, "maxX": bounds.maxX + 1.5, "minY": 0.05, "maxY": 2.4, "minZ": bounds.minZ - 1.5, "maxZ": bounds.maxZ + 1.5 }
	_span = Vector3(_room.maxX - _room.minX, _room.maxY - _room.minY, _room.maxZ - _room.minZ)
	var motes := mini(int(D.cap), roundi(float(D.density) * _span.x * _span.y * _span.z))
	_columns = ceili(_span.x)
	_rows = ceili(_span.z)
	for k in _columns * _rows:
		_cells.append([])
	for i in motes:
		var x: float = _room.minX + random.call() * _span.x
		var y: float = _room.minY + random.call() * _span.y
		_anchor.append(Vector3(x, y, _room.minZ + random.call() * _span.z))
		var a := Feel.pick(D.wander.rate)
		var b := Feel.pick(D.wander.rate)
		_wander.append(Vector3(a, b, Feel.pick(D.wander.rate)))
		_phase.append(random.call() * TAU)
		_swirl.append(Feel.pick(D.swirl) * (-1.0 if random.call() < 0.5 else 1.0))
		_orbit.append(Feel.pick(D.orbit))
		_size.append(Feel.pick(D.size))
		_drift.append(Vector3.ZERO)
		_cell.append(-1)
		_file(i)
	_seen_at.resize(motes)
	_seen_at.fill(-1)
	_glow_of.resize(motes)
	_placed.resize(motes)
	_dust = MeshInstance3D.new()
	_dust.name = "Lamp dust"
	_dust.mesh = ArrayMesh.new()
	_dust.extra_cull_margin = 16384.0
	_dust.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var material := ShaderMaterial.new()
	material.shader = load("res://shaders/lamp_dust.gdshader")
	material.set_shader_parameter("tint", Vector3(_warmth.r, _warmth.g, _warmth.b))
	_dust.material_override = material
	add_child(_dust)


func _cell_at(x: float, z: float) -> int:
	return clampi(floori(z - _room.minZ), 0, _rows - 1) * _columns + clampi(floori(x - _room.minX), 0, _columns - 1)


func _file(index: int) -> void:
	var cell := _cell_at(_anchor[index].x, _anchor[index].z)
	if cell == _cell[index]:
		return
	if _cell[index] >= 0:
		_cells[_cell[index]].erase(index)
	_cells[cell].append(index)
	_cell[index] = cell


func _each_near(min_x: float, min_z: float, max_x: float, max_z: float) -> Array:
	var found: Array = []
	var x0 := maxi(0, floori(min_x - _room.minX))
	var x1 := mini(_columns - 1, floori(max_x - _room.minX))
	var z0 := maxi(0, floori(min_z - _room.minZ))
	var z1 := mini(_rows - 1, floori(max_z - _room.minZ))
	for z in range(z0, z1 + 1):
		for x in range(x0, x1 + 1):
			found.append_array(_cells[z * _columns + x])
	return found


## Where a mote is now: round its anchor on slow eddies, twirling.
func _where(i: int) -> Vector3:
	var t := _clock
	var p := _phase[i]
	var rates := _wander[i]
	var w: float = _blackout.dust.wander.reach
	var turn := p + t * _swirl[i]
	var orbit := _orbit[i]
	var anchor := _anchor[i]
	return Vector3(
		anchor.x + w * (sin(t * rates.x + p) + 0.5 * sin(t * rates.y * 1.7 + p * 2.3)) + cos(turn) * orbit,
		anchor.y + w * 0.35 * sin(t * rates.z + p * 1.3) + sin(turn * 1.3) * orbit * 0.6,
		anchor.z + w * (cos(t * rates.y + p * 1.9) + 0.5 * cos(t * rates.x * 1.3 + p * 0.7)) + sin(turn) * orbit)


## A trooper's beam (made when first needed); the lamp itself is off until switched on.
func _beam_of(trooper: Object) -> Dictionary:
	if _beams.has(trooper):
		return _beams[trooper]
	# The lens: a hot little core in a wider soft glow.
	var glint := ImpactEffects.glow_quad(self, "Lamp glint", _glint_map)
	glint.scale = Vector3.ONE * 0.2
	var halo := ImpactEffects.glow_quad(self, "Lamp halo", _glint_map)
	halo.scale = Vector3.ONE * 0.85
	var beam := { "glint": glint, "halo": halo, "on": 0.0, "switch_at": INF, "switched": false, "flicker": 0.0, "reach": 1.0, "lens": Vector3.ZERO, "forward": Vector3(0, 0, 1), "dies_at": INF, "fading": 1.0, "seed": random.call() * 100.0, "out": false }
	_beams[trooper] = beam
	return beam


## The dark comes: every lamp is switched on after a moment of its own.
func darkness(troopers: Array) -> void:
	for trooper: Stormtrooper in troopers:
		var beam := _beam_of(trooper)
		if not beam.switched and not trooper.dead:
			beam.switch_at = _clock + Feel.pick(_blackout.onAfter)


## The power back (a restart): all off.
func clear() -> void:
	for beam in _beams.values():
		beam.glint.queue_free()
		beam.halo.queue_free()
	_beams.clear()
	volumes.clear()
	for k in pool.size():
		pool[k].light_energy = 0.0
		spills[k].light_energy = 0.0
	for mesh in _beam_meshes:
		mesh.visible = false
	_shown = 0
	(_dust.mesh as ArrayMesh).clear_surfaces()


func _hide(beam: Dictionary) -> void:
	beam.glint.visible = false
	beam.halo.visible = false


## A dead man's lamp: 1 until its battery starts to go, then fewer and dimmer flashes, then 0 for good.
func _failing(beam: Dictionary) -> float:
	if _clock < beam.dies_at:
		return 1.0
	var progress: float = (_clock - beam.dies_at) / beam.fading
	if progress >= 1.0:
		return 0.0
	var slot := floorf((_clock - beam.dies_at) * float(_blackout.dying.rate))
	var chance := fmod(absf(sin(slot * 12.9898 + beam.seed) * 43758.5453), 1.0)
	return (0.45 + 0.55 * chance) * (1.0 - 0.5 * progress) if chance > 0.08 + 0.85 * pow(progress, 1.5) else 0.03


func update(dt: float, troopers: Array, hero: Vector3, night: float, stirs: Array = []) -> Array:
	_clock += dt
	_time += dt
	var clicks: Array = []
	var lit: Array = []
	var B: Dictionary = _blackout.beam
	for trooper: Stormtrooper in troopers:
		var beam: Variant = _beams.get(trooper)
		if beam == null:
			if night <= 0.5:
				continue
			beam = _beam_of(trooper)
		# A newcomer in the dark switches his on too (not a dead man).
		if night > 0.5 and not beam.switched and beam.switch_at == INF and not trooper.dead:
			beam.switch_at = _clock + Feel.pick(_blackout.onAfter) * 0.5
		var rifle: Node3D = trooper.parts.get("blaster")
		if rifle == null or not rifle.is_inside_tree():
			_hide(beam)
			continue
		if trooper.dead and not beam.switched:
			beam.switch_at = INF
		if not beam.switched and _clock >= beam.switch_at:
			beam.switched = true
			beam.flicker = 0.35
			clicks.append(trooper)
		# Dead, his lamp lit: in a few seconds its battery starts to go.
		if trooper.dead and beam.switched and beam.dies_at == INF:
			beam.dies_at = _clock + Feel.pick(_blackout.dying.after)
			beam.fading = Feel.pick(_blackout.dying.flicker)
		# Switched on: a stutter, then steady; a dead man's, failing, then out.
		if beam.switched and not beam.out:
			beam.flicker = maxf(0.0, beam.flicker - dt)
			var stutter := (1.0 if sin(beam.flicker * 90.0) > 0.2 else 0.15) if beam.flicker > 0.0 else 1.0
			var left := _failing(beam)
			if left <= 0.0:
				beam.out = true
				clicks.append(trooper)
			beam.on = night * stutter * left
		else:
			beam.on = 0.0
		if beam.on <= 0.01:
			_hide(beam)
			continue
		var frame := rifle.global_transform
		var lens: Vector3 = frame * LENS
		var forward := (frame.basis * Vector3(0, 0, 1)).normalized()
		# A crate or a wall in the way: the beam stops on it (light passes the railings, as bolts do); the floor stops it too.
		var end := lens + forward * float(B.length)
		var hit := obstacles.segment_hit(lens, end, func(box: Dictionary) -> bool: return box.kind == "rail") if obstacles else {}
		var reach: float = maxf(0.08, hit.t) if not hit.is_empty() else 1.0
		if forward.y < -1e-3:
			reach = minf(reach, maxf(0.08, lens.y / (-forward.y * float(B.length))))
		beam.reach = reach
		for quad: MeshInstance3D in [beam.glint, beam.halo]:
			quad.position = lens
			quad.visible = true
		beam.glint.material_override.set_shader_parameter("tint", Color(_warmth.r * 1.8, _warmth.g * 1.8, _warmth.b * 1.8, beam.on))
		beam.halo.material_override.set_shader_parameter("tint", Color(_warmth.r * 0.45, _warmth.g * 0.45, _warmth.b * 0.45, beam.on))
		beam.lens = lens
		beam.forward = forward
		lit.append({ "beam": beam, "at": lens, "forward": forward, "on": beam.on, "distance": lens.distance_to(hero) })
	# The real lights for the rifles nearest the hero.
	lit.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return a.distance < b.distance)
	var lamp: Dictionary = _blackout.lamp
	for index in pool.size():
		var light := pool[index]
		var spill := spills[index]
		if index >= lit.size():
			light.light_energy = 0.0
			spill.light_energy = 0.0
			continue
		var entry: Dictionary = lit[index]
		var target: Vector3 = entry.at + entry.forward * 4.0
		var up := Vector3.UP if absf((entry.forward as Vector3).y) < 0.99 else Vector3.RIGHT
		light.look_at_from_position(entry.at, target, up)
		light.light_energy = float(lamp.intensity) * entry.on * LabLevel.LIGHT_SCALE
		spill.position = entry.at + entry.forward * 0.35
		spill.light_energy = float(lamp.spill) * entry.on * LabLevel.LIGHT_SCALE
	# The beams in the air: each stops on what is in the way.
	volumes.clear()
	for index in _beam_meshes.size():
		var mesh := _beam_meshes[index]
		if index >= lit.size():
			mesh.visible = false
			continue
		var entry: Dictionary = lit[index]
		var length: float = float(B.length) * entry.beam.reach
		volumes.append({ "lens": entry.at, "forward": entry.forward, "on": entry.on, "length": length })
		var radius: float = float(B.radius) / float(B.length) * length
		var forward: Vector3 = entry.forward
		var up := Vector3.UP if absf(forward.y) < 0.99 else Vector3.RIGHT
		var side := up.cross(forward).normalized()
		var basis := Basis(side * (radius * 2.2), forward.cross(side).normalized() * (radius * 2.2), forward * length)
		mesh.global_transform = Transform3D(basis, entry.at + forward * (length * 0.5))
		var material: ShaderMaterial = mesh.material_override
		material.set_shader_parameter("lens", entry.at)
		material.set_shader_parameter("axis", forward)
		material.set_shader_parameter("beam_length", length)
		material.set_shader_parameter("on", entry.on)
		material.set_shader_parameter("time", _time)
		mesh.visible = true
	_update_dust(dt, lit.map(func(entry: Dictionary) -> Dictionary: return entry.beam), stirs)
	return clicks


## The motes: each wanders round the point where it hangs, and is drawn only
## if a beam lights it — brightest near the lamp and on the axis, twinkling
## as it twirls. Only the motes over the floor a lit beam covers are looked
## at. Day, or no lamp on: nothing to see, nothing done.
func _update_dust(dt: float, live: Array, stirs: Array) -> void:
	_shown = 0
	var mesh: ArrayMesh = _dust.mesh
	mesh.clear_surfaces()
	if live.is_empty():
		return
	var D: Dictionary = _blackout.dust
	var B: Dictionary = _blackout.beam
	# Pushed aside and whirled by the hero or his blade going through; they slow down and stay where they end.
	var R: float = D.reach
	for stir in stirs:
		if stir.speed < 0.5:
			continue
		var at: Vector3 = stir.at
		for index in _each_near(at.x - R, at.z - R, at.x + R, at.z + R):
			var point := _where(index)
			var d2 := point.distance_squared_to(at)
			if d2 > R * R:
				continue
			var d := sqrt(d2) + 1e-3
			var push: float = (1.0 - d / R) * stir.speed * float(D.stir) * dt
			var spin := -0.6 if random.call() < 0.5 else 0.6
			var local := (point - at) / d
			var velocity := _drift[index]
			velocity.x += (local.x - local.z * spin + random.call() - 0.5) * push
			velocity.y += (local.y + random.call() - 0.5) * push * 0.4
			velocity.z += (local.z + local.x * spin + random.call() - 0.5) * push
			if velocity.length_squared() > 2.25:
				velocity = velocity.normalized() * 1.5
			_drift[index] = velocity
			_moving[index] = true
	for index: int in _moving.keys():
		var anchor := _anchor[index] + _drift[index] * dt
		anchor.y = clampf(anchor.y, _room.minY, _room.maxY)
		_anchor[index] = anchor
		_drift[index] *= exp(-dt / float(D.settle))
		_file(index)
		if _drift[index].length_squared() < 1e-4:
			_drift[index] = Vector3.ZERO
			_moving.erase(index)
	# Lit by a beam? (Not right at the lens: the glint is there.)
	_frame += 1
	var touched := PackedInt32Array()
	var margin: float = float(D.wander.reach) * 1.5 + float(D.orbit[1])
	var full: float = B.length
	var radius_full: float = B.radius
	for beam: Dictionary in live:
		var length: float = full * beam.reach
		var lens: Vector3 = beam.lens
		var forward: Vector3 = beam.forward
		var end := lens + forward * length
		var r: float = radius_full * beam.reach + margin
		for index in _each_near(minf(lens.x, end.x) - r, minf(lens.z, end.z) - r, maxf(lens.x, end.x) + r, maxf(lens.z, end.z) + r):
			# Too far from the cone for its wandering to bring it in: skipped before working out where it is.
			var local := _anchor[index] - lens
			var ahead := local.dot(forward)
			var limit := radius_full * maxf(0.0, ahead) / full + margin
			if ahead < -margin or ahead > length + margin or local.length_squared() - ahead * ahead > limit * limit:
				continue
			if _seen_at[index] != _frame:
				_seen_at[index] = _frame
				_glow_of[index] = 0.0
				_placed[index] = _where(index)
				touched.append(index)
			local = _placed[index] - lens
			var along := local.dot(forward) / full
			if along < 0.05 or along > beam.reach:
				continue
			var edge := (local - forward * (along * full)).length_squared() / pow(radius_full * along, 2.0)
			if edge < 1.0:
				_glow_of[index] += beam.on * (1.0 - along) * (1.0 - edge) * minf(1.0, (along - 0.05) * 12.0)
	var points := PackedVector3Array()
	var uvs := PackedVector2Array()
	for index in touched:
		if _glow_of[index] < 0.01:
			continue
		points.append(_placed[index])
		uvs.append(Vector2(_size[index], minf(1.0, _glow_of[index]) * float(D.glow) * (0.55 + 0.45 * sin(_clock * 2.3 + _phase[index] * 3.0))))
	_shown = points.size()
	if points.is_empty():
		return
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = points
	arrays[Mesh.ARRAY_TEX_UV] = uvs
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_POINTS, arrays)


## How many lamps are on (beams showing).
func lamps_on() -> int:
	var count := 0
	for beam in _beams.values():
		if beam.glint.visible:
			count += 1
	return count


## Motes glowing now (in a beam).
func motes() -> int:
	return _shown
