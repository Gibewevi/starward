class_name JungleAir
extends Node3D
## The jungle's air (port of src/jungle-air.js): moonlight falling through the
## gaps in the canopy as shafts in the damp air (worked out pixel by pixel as
## the rifle lamps' beams are, shaders/lamp_beam.gdshader), dust and pollen
## drifting in them — seen only where a shaft or a lamp of the ruins lights
## them, whirled aside by whoever goes through — and fireflies wandering low
## over the plants, blinking.
##
## On a black night the moon barely comes through: the dust hangs thick before
## the lamps of the ruins instead, warm in their light.
##
## What lights each mote is worked out once (the shafts and lamps stand still):
## each frame only the lamps' levels (a zone cut) change it.

const MOTES := 1400
const MOON := Color(0.62, 0.86, 0.95)
const WARM := Color(1.2, 0.78, 0.42)
## Vertex colours stop at 1: the points' light is stored over this, and multiplied back (shaders/air_motes.gdshader).
const BRIGHT := 2.5

var bounds: Dictionary
var night := false
var random: Callable
var beams: Array = []
var _lamps: Array = []
var _home := PackedVector3Array()
var _push := PackedVector3Array()
var _phase := PackedFloat32Array()
## The moonlight on each mote (from the shafts), and the lamps that light it: [lamp index, share] pairs.
var _moonlit := PackedColorArray()
var _lit_by: Array = []
var _motes: MeshInstance3D
var _flies: MeshInstance3D
var _fly_at := PackedVector3Array()
var _fly_v := PackedVector3Array()
var _fly_blink := PackedFloat32Array()
var _fly_rate := PackedFloat32Array()
var _fly_wander := PackedFloat32Array()
var _beam_meshes: Array[MeshInstance3D] = []


## shafts: [[x, z, strength]] (the moon's gaps over the marsh); lamps: the ruins' ({ position, color, base, intensity }).
func _init(rect: Dictionary, shafts: Array, lamps: Array, dark: bool, draw: Callable = Callable()) -> void:
	name = "Jungle air"
	bounds = rect
	night = dark
	_lamps = lamps
	random = draw if draw.is_valid() else func() -> float: return randf()
	var forward := Vector3(0.22, -1, 0.12).normalized()
	for shaft: Array in shafts:
		var at := Vector3(shaft[0], 0, shaft[1]) - forward * 9.0
		beams.append({ "lens": at, "forward": forward, "length": 10.5, "on": shaft[2] * (0.25 if night else 1.0) })
	_make_motes()
	_make_flies()
	_make_shafts()


func _make_motes() -> void:
	# Where the dust hangs: in the shafts, before the lamps, anywhere (shares).
	var in_shafts := 0.15 if night else 0.65
	var by_lamps := 0.85
	var lamp_reach := 3.2 if night else 2.6
	var lamp_glow := 1.25 if night else 0.9
	for i in MOTES:
		var pick: float = random.call()
		var at: Vector3
		if pick < in_shafts and not beams.is_empty():
			var beam: Dictionary = beams[i % beams.size()]
			var along: float = random.call() * beam.length * 0.95
			var radius: float = 0.12 * along * random.call()
			var x: float = random.call() - 0.5
			var y: float = random.call() - 0.5
			var side := Vector3(x, y, random.call() - 0.5).normalized() * radius
			at = beam.lens + beam.forward * along + side
			at.y = maxf(0.15, at.y)
		elif pick < by_lamps and not _lamps.is_empty():
			var lamp: Vector3 = _lamps[i % _lamps.size()].position
			var x: float = lamp.x + (random.call() - 0.5) * 3.0
			var y: float = 0.2 + random.call() * 2.6
			at = Vector3(x, y, lamp.z + (random.call() - 0.5) * 3.0)
		else:
			var x: float = bounds.minX + random.call() * (bounds.maxX - bounds.minX)
			var y: float = 0.2 + random.call() * 3.0
			at = Vector3(x, y, bounds.minZ + random.call() * (bounds.maxZ - bounds.minZ))
		_home.append(at)
		_push.append(Vector3.ZERO)
		_phase.append(random.call() * 100.0)
		# What lights it: the shafts it hangs in (moonlight), the lamps near it (warm).
		var moon := Color(0, 0, 0)
		for beam in beams:
			var local: Vector3 = at - beam.lens
			var along: float = local.dot(beam.forward)
			if along <= 0.0 or along >= beam.length:
				continue
			var radius := 0.13 * along
			var off: float = (local - beam.forward * along).length()
			if off >= radius:
				continue
			var share: float = (1.0 - off / radius) * (1.0 - along / beam.length * 0.6) * beam.on
			moon += MOON * share
		_moonlit.append(moon)
		var near: Array = []
		for k in _lamps.size():
			var d: float = (_lamps[k].position as Vector3).distance_to(at)
			if d <= lamp_reach:
				near.append([k, pow(1.0 - d / lamp_reach, 2.0) * lamp_glow])
		_lit_by.append(near)
	_motes = MeshInstance3D.new()
	_motes.name = "Motes"
	_motes.mesh = ArrayMesh.new()
	_motes.extra_cull_margin = 16384.0
	_motes.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var material := ShaderMaterial.new()
	material.shader = load("res://shaders/air_motes.gdshader")
	_motes.material_override = material
	add_child(_motes)


func _make_flies() -> void:
	# As many as the ground is big (46 to a clearing of 24 by 18 m).
	var count := roundi(46.0 * (bounds.maxX - bounds.minX) * (bounds.maxZ - bounds.minZ) / 432.0)
	for i in count:
		var x: float = bounds.minX + random.call() * (bounds.maxX - bounds.minX)
		var y: float = 0.3 + random.call() * 1.2
		_fly_at.append(Vector3(x, y, bounds.minZ + random.call() * (bounds.maxZ - bounds.minZ)))
		_fly_v.append(Vector3.ZERO)
		_fly_blink.append(random.call() * 6.0)
		_fly_rate.append(0.25 + random.call() * 0.4)
		_fly_wander.append(random.call() * 100.0)
	_flies = MeshInstance3D.new()
	_flies.name = "Fireflies"
	_flies.mesh = ArrayMesh.new()
	_flies.extra_cull_margin = 16384.0
	_flies.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var material := ShaderMaterial.new()
	material.shader = load("res://shaders/air_motes.gdshader")
	_flies.material_override = material
	add_child(_flies)


## The shafts in the damp air: the rifle lamps' beam, cold, faint, wide.
func _make_shafts() -> void:
	var box := BoxMesh.new()
	box.size = Vector3.ONE
	var shader: Shader = load("res://shaders/lamp_beam.gdshader")
	var spread := 0.13
	for beam in beams:
		var mesh := MeshInstance3D.new()
		mesh.name = "Moonlight shaft"
		mesh.mesh = box
		mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		var material := ShaderMaterial.new()
		material.shader = shader
		material.set_shader_parameter("tint", Vector3(0.55, 0.8, 0.9))
		material.set_shader_parameter("level", 0.05 if night else 0.2)
		material.set_shader_parameter("spread", spread)
		material.set_shader_parameter("full", 11.0)
		material.set_shader_parameter("haze", 0.4)
		material.set_shader_parameter("lens", beam.lens)
		material.set_shader_parameter("axis", beam.forward)
		material.set_shader_parameter("beam_length", beam.length)
		material.set_shader_parameter("on", beam.on)
		mesh.material_override = material
		var forward: Vector3 = beam.forward
		var side := Vector3.UP.cross(forward).normalized() if absf(forward.y) < 0.99 else Vector3.RIGHT
		var radius: float = spread * beam.length
		mesh.transform = Transform3D(Basis(side * (radius * 2.2), forward.cross(side).normalized() * (radius * 2.2), forward * beam.length), beam.lens + forward * (beam.length * 0.5))
		add_child(mesh)
		_beam_meshes.append(mesh)


## stirs: points moving through the air ({ at, speed }) that push the dust and startle the fireflies.
func update(dt: float, time: float, stirs: Array = []) -> void:
	for mesh in _beam_meshes:
		mesh.material_override.set_shader_parameter("time", time)
	# The lamps' levels now (a zone cut lights its dust no more).
	var levels := PackedFloat32Array()
	for lamp in _lamps:
		levels.append(minf(1.0, lamp.intensity / maxf(lamp.base, 1e-3)))
	var points := PackedVector3Array()
	var colours := PackedColorArray()
	var sizes := PackedVector2Array()
	var settle := exp(-0.6 * dt)
	for i in MOTES:
		var t := time * 0.35 + _phase[i]
		var home := _home[i]
		var push := _push[i]
		# Pushed aside by whoever passes, settling slowly back.
		for stir in stirs:
			var away: Vector3 = home + push - stir.at
			var d := away.length()
			if d > 0.9 or d < 1e-4:
				continue
			var shove: float = (1.0 - d / 0.9) * minf(stir.speed, 8.0) * 0.04
			push += Vector3(away.x / d * shove + away.z / d * shove * 0.6, away.y / d * shove * 0.5 + shove * 0.2, away.z / d * shove - away.x / d * shove * 0.6)
		push *= settle
		_push[i] = push
		var light := _moonlit[i]
		for entry: Array in _lit_by[i]:
			light += WARM * (entry[1] * levels[entry[0]])
		var g := minf(1.0, maxf(light.r, maxf(light.g, light.b)))
		var glow := g * (0.55 + 0.45 * sin(t * 3.0 + i))
		if glow < 0.02:
			continue
		points.append(home + push + Vector3(sin(t * 1.3) * 0.12, sin(t * 0.9 + 1.0) * 0.08, cos(t * 1.1) * 0.12))
		var tint := light / maxf(g, 1e-3)
		colours.append(Color(tint.r * glow / BRIGHT, tint.g * glow / BRIGHT, tint.b * glow / BRIGHT))
		sizes.append(Vector2(1.0 + (1.0 if glow > 0.6 else 0.0), 0))
	_draw(_motes, points, colours, sizes)
	points = PackedVector3Array()
	colours = PackedColorArray()
	sizes = PackedVector2Array()
	for i in _fly_at.size():
		_fly_wander[i] += dt
		var w := _fly_wander[i]
		var v := _fly_v[i] + Vector3(sin(w * 1.7 + i), sin(w * 2.3 + i * 2) * 0.5, cos(w * 1.3 + i * 3)) * (dt * 0.9)
		# Startled by whoever comes close.
		for stir in stirs:
			var away: Vector3 = _fly_at[i] - stir.at
			var d := away.length()
			if d < 1.2 and d > 1e-3:
				v += away / d * ((1.2 - d) * 3.0 * dt)
		v *= exp(-1.2 * dt)
		_fly_v[i] = v
		var at := _fly_at[i] + v * dt
		at.y = clampf(at.y, 0.25, 1.9)
		at.x = clampf(at.x, bounds.minX + 0.5, bounds.maxX - 0.5)
		at.z = clampf(at.z, bounds.minZ + 0.5, bounds.maxZ - 0.5)
		_fly_at[i] = at
		# A slow pulse: on for a moment, off for longer.
		var pulse := pow(maxf(0.0, sin((time + _fly_blink[i]) * _fly_rate[i] * TAU)), 3.0)
		if pulse < 0.02:
			continue
		points.append(at)
		colours.append(Color(1.4 * pulse / BRIGHT, 2.2 * pulse / BRIGHT, 0.55 * pulse / BRIGHT))
		sizes.append(Vector2(2.0, 0))
	_draw(_flies, points, colours, sizes)


## Points: their colour (light added, over BRIGHT: vertex colours stop at 1), their size in pixels (UV.x).
static func _draw(target: MeshInstance3D, points: PackedVector3Array, colours: PackedColorArray, sizes: PackedVector2Array) -> void:
	var mesh: ArrayMesh = target.mesh
	mesh.clear_surfaces()
	if points.is_empty():
		return
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = points
	arrays[Mesh.ARRAY_COLOR] = colours
	arrays[Mesh.ARRAY_TEX_UV] = sizes
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_POINTS, arrays)
