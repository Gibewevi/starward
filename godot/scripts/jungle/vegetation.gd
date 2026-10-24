class_name Vegetation
extends Node3D
## The jungle's plants (port of src/vegetation.js): tufts of grass of every
## height, ferns, broad-leaved plants and reeds — their shapes and where each
## grows baked from the web (assets/data/jungle.json), each kind a MultiMesh
## by patch of ground (10 m a side, so only the patches in view are drawn).
##
## Everything moves in the vertex shader (shaders/plants.gdshader): the wind,
## whoever goes through (`pushers`), an explosion's front (blast), the Force
## (gust). A blade going through a plant cuts it at the height it passed (what
## is left is a stub) and throws bits of leaf along the swing; a blast tears up
## what grew where it opened its crater (uproot).

const CHUNK := 10.0
const CELL := 1.0
const BITS := 320
const PUSHERS := 8
const BLASTS := 4
const GUSTS := 2
const KINDS := {
	"grass": { "radius": 0.12, "leaves": 2, "color": Color(0.2, 0.42, 0.12) },
	"reed": { "radius": 0.12, "leaves": 2, "color": Color(0.22, 0.38, 0.14) },
	"fern": { "radius": 0.4, "leaves": 7, "color": Color(0.12, 0.36, 0.1) },
	"broadleaf": { "radius": 0.45, "leaves": 8, "color": Color(0.1, 0.3, 0.12) },
}

var random: Callable
## Each patch: { kind, multimesh, plants (rows of the baked list), cut }.
var entries: Array = []
var _grid := {}
var _material: ShaderMaterial
var _time := 0.0
var _push := PackedVector4Array()
var _blasts := PackedVector4Array()
var _blast_radius := PackedFloat32Array()
var _gust_a := PackedVector4Array()
var _gust_b := PackedVector4Array()
var _next_blast := 0
var _next_gust := 0
var _bits: MultiMesh
var _bit_alive := PackedByteArray()
var _bit_settled := PackedByteArray()
var _bit_p := PackedVector3Array()
var _bit_v := PackedVector3Array()
var _bit_spin := PackedVector3Array()
var _bit_turn := PackedVector3Array()
var _bit_age := PackedFloat32Array()
var _bit_life := PackedFloat32Array()
var _next_bit := 0


func _init(data: Dictionary, draw: Callable = Callable()) -> void:
	name = "Jungle plants"
	random = draw if draw.is_valid() else func() -> float: return randf()
	_material = ShaderMaterial.new()
	_material.shader = load("res://shaders/plants.gdshader")
	_push.resize(PUSHERS)
	_blasts.resize(BLASTS)
	_blasts.fill(Vector4(0, 0, -99, 0))
	_blast_radius.resize(BLASTS)
	_blast_radius.fill(1.0)
	_gust_a.resize(GUSTS)
	_gust_b.resize(GUSTS)
	_gust_b.fill(Vector4(-99, 0, 1, 1))
	for kind: String in data:
		var mesh := _shape(data[kind].shape)
		var patches := {}
		for plant: Array in data[kind].plants:
			var key := Vector2i(floori(plant[0] / CHUNK), floori(plant[1] / CHUNK))
			if not patches.has(key):
				patches[key] = []
			patches[key].append(plant)
		for key: Vector2i in patches:
			var plants: Array = patches[key]
			var multimesh := MultiMesh.new()
			multimesh.transform_format = MultiMesh.TRANSFORM_3D
			multimesh.use_colors = true
			multimesh.use_custom_data = true
			multimesh.mesh = mesh
			multimesh.instance_count = plants.size()
			for i in plants.size():
				var plant: Array = plants[i]
				var basis := Basis(Vector3.UP, plant[2]).scaled(Vector3(plant[3], plant[4], plant[3]))
				multimesh.set_instance_transform(i, Transform3D(basis, Vector3(plant[0], 0, plant[1])))
				multimesh.set_instance_color(i, Color(plant[5], plant[6], plant[7]))
				multimesh.set_instance_custom_data(i, Color(plant[8], 1.0, 0, 0))
			var instance := MultiMeshInstance3D.new()
			instance.name = "Jungle %s" % kind
			instance.multimesh = multimesh
			instance.material_override = _material
			# The big plants cast their shadows (swaying with them); the grass only takes them.
			instance.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF if kind == "grass" else GeometryInstance3D.SHADOW_CASTING_SETTING_ON
			instance.extra_cull_margin = 1.5
			add_child(instance)
			var cut := PackedFloat32Array()
			cut.resize(plants.size())
			cut.fill(1.0)
			var entry := { "kind": kind, "multimesh": multimesh, "plants": plants, "cut": cut }
			entries.append(entry)
			var index := entries.size() - 1
			for i in plants.size():
				var cell := Vector2i(floori(plants[i][0] / CELL), floori(plants[i][1] / CELL))
				if not _grid.has(cell):
					_grid[cell] = []
				_grid[cell].append(Vector2i(index, i))
	_make_bits()


## A baked shape: its triangles, normals, colours; how much each vertex sways in UV.x.
static func _shape(shape: Dictionary) -> ArrayMesh:
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	var positions: Array = shape.positions
	var normals: Array = shape.normals
	var colours: Array = shape.colors
	var vertices := PackedVector3Array()
	var normal_list := PackedVector3Array()
	var colour_list := PackedColorArray()
	var bends := PackedVector2Array()
	for k in positions.size() / 3:
		vertices.append(Vector3(positions[k * 3], positions[k * 3 + 1], positions[k * 3 + 2]))
		normal_list.append(Vector3(normals[k * 3], normals[k * 3 + 1], normals[k * 3 + 2]))
		colour_list.append(Color(colours[k * 3], colours[k * 3 + 1], colours[k * 3 + 2]))
		bends.append(Vector2(shape.bends[k], 0))
	# Godot's front faces wind the other way.
	var indices := PackedInt32Array()
	var source: Array = shape.indices
	for t in source.size() / 3:
		indices.append_array([source[t * 3], source[t * 3 + 2], source[t * 3 + 1]])
	arrays[Mesh.ARRAY_VERTEX] = vertices
	arrays[Mesh.ARRAY_NORMAL] = normal_list
	arrays[Mesh.ARRAY_COLOR] = colour_list
	arrays[Mesh.ARRAY_TEX_UV] = bends
	arrays[Mesh.ARRAY_INDEX] = indices
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return mesh


func _make_bits() -> void:
	var quad := QuadMesh.new()
	quad.size = Vector2(0.07, 0.035)
	var material := StandardMaterial3D.new()
	material.vertex_color_use_as_albedo = true
	material.cull_mode = BaseMaterial3D.CULL_DISABLED
	material.roughness = 0.9
	_bits = MultiMesh.new()
	_bits.transform_format = MultiMesh.TRANSFORM_3D
	_bits.use_colors = true
	_bits.mesh = quad
	_bits.instance_count = BITS
	_bits.visible_instance_count = 0
	var instance := MultiMeshInstance3D.new()
	instance.name = "Cut leaves"
	instance.multimesh = _bits
	instance.material_override = material
	instance.extra_cull_margin = 16384.0
	add_child(instance)
	for array in [_bit_alive, _bit_settled]:
		array.resize(BITS)
	for array in [_bit_p, _bit_v, _bit_spin, _bit_turn]:
		array.resize(BITS)
	for array in [_bit_age, _bit_life]:
		array.resize(BITS)


func _throw_bits(at: Vector3, along: Vector3, speed: float, count: int, tint: Color) -> void:
	for n in count:
		var i := _next_bit
		_next_bit = (_next_bit + 1) % BITS
		_bit_alive[i] = 1
		_bit_settled[i] = 0
		_bit_age[i] = 0.0
		_bit_life[i] = 6.0 + random.call() * 6.0
		var x: float = (random.call() - 0.5) * 0.15
		var y: float = (random.call() - 0.3) * 0.15
		_bit_p[i] = at + Vector3(x, y, (random.call() - 0.5) * 0.15)
		var vx: float = (random.call() - 0.5) * 1.2
		var vy: float = 0.8 + random.call() * 1.6
		_bit_v[i] = along * (minf(speed, 12.0) * (0.15 + random.call() * 0.3)) + Vector3(vx, vy, (random.call() - 0.5) * 1.2)
		var sx: float = (random.call() - 0.5) * 18.0
		var sy: float = (random.call() - 0.5) * 18.0
		_bit_spin[i] = Vector3(sx, sy, (random.call() - 0.5) * 18.0)
		_bit_turn[i] = Vector3.ZERO
		var shade: Color = tint
		shade.h += (random.call() - 0.5) * 0.05
		shade.v = clampf(shade.v + (random.call() - 0.5) * 0.12, 0.0, 1.0)
		_bits.set_instance_color(i, shade)
	_bits.visible_instance_count = BITS


func _update_bits(dt: float) -> void:
	for i in BITS:
		if _bit_alive[i] == 0:
			_bits.set_instance_transform(i, Transform3D(Basis.from_scale(Vector3.ZERO), Vector3.ZERO))
			continue
		_bit_age[i] += dt
		if _bit_age[i] > _bit_life[i]:
			_bit_alive[i] = 0
			continue
		if _bit_settled[i] == 0:
			# Light: the air holds them up, they flutter down.
			var v := _bit_v[i]
			v.y -= 4.2 * dt
			v *= exp(-2.6 * dt)
			v.x += sin(_bit_age[i] * 7.0 + i) * 0.6 * dt
			_bit_v[i] = v
			var p := _bit_p[i] + v * dt
			_bit_turn[i] += _bit_spin[i] * dt
			if p.y < 0.01:
				p.y = 0.01
				_bit_settled[i] = 1
				_bit_turn[i] = Vector3(-PI / 2.0, 0, _bit_turn[i].z)
			_bit_p[i] = p
		var fade := minf(1.0, (_bit_life[i] - _bit_age[i]) / 1.5)
		var basis := Basis.from_euler(_bit_turn[i], EULER_ORDER_XYZ).scaled(Vector3.ONE * fade)
		_bits.set_instance_transform(i, Transform3D(basis, _bit_p[i]))


func _set_cut(entry: Dictionary, index: int, value: float) -> void:
	entry.cut[index] = value
	var custom: Color = entry.multimesh.get_instance_custom_data(index)
	custom.g = value
	entry.multimesh.set_instance_custom_data(index, custom)


## The blade swept from (a0, b0) to (a1, b1): plants in its way are cut where it passed. Returns how many.
func cut(a0: Vector3, b0: Vector3, a1: Vector3, b1: Vector3, speed: float) -> int:
	if speed < 3.5:
		return 0
	var along := Vector3(b1.x - b0.x, 0, b1.z - b0.z)
	if along.length_squared() < 1e-6:
		along = Vector3(a1.x - a0.x, 0, a1.z - a0.z)
	along = along.normalized()
	var min_x := minf(minf(a0.x, b0.x), minf(a1.x, b1.x)) - 0.5
	var max_x := maxf(maxf(a0.x, b0.x), maxf(a1.x, b1.x)) + 0.5
	var min_z := minf(minf(a0.z, b0.z), minf(a1.z, b1.z)) - 0.5
	var max_z := maxf(maxf(a0.z, b0.z), maxf(a1.z, b1.z)) + 0.5
	# The blade's path, not only where it is now: a fast swing goes further than a stem between frames.
	var steps := mini(10, maxi(1, ceili(maxf(a0.distance_to(a1), b0.distance_to(b1)) / 0.08)))
	var count := 0
	for x in range(floori(min_x / CELL), floori(max_x / CELL) + 1):
		for z in range(floori(min_z / CELL), floori(max_z / CELL) + 1):
			for found: Vector2i in _grid.get(Vector2i(x, z), []):
				var entry: Dictionary = entries[found.x]
				var index := found.y
				var plant: Array = entry.plants[index]
				var standing_cut: float = entry.cut[index]
				if standing_cut < 0.12:
					continue
				# Where the blade crosses the stem: nearest to it seen from above, at the height it has there.
				var kind: Dictionary = KINDS[entry.kind]
				var reach: float = kind.radius * plant[3]
				var height: float = plant[4]
				var standing := height * standing_cut
				var crossing := INF
				for step in range(1, steps + 1):
					var a := a0.lerp(a1, float(step) / steps)
					var b := b0.lerp(b1, float(step) / steps)
					var dx := b.x - a.x
					var dz := b.z - a.z
					var flat := dx * dx + dz * dz
					var t := clampf(((plant[0] - a.x) * dx + (plant[1] - a.z) * dz) / flat, 0.0, 1.0) if flat > 1e-6 else (0.0 if a.y < b.y else 1.0)
					if Vector2(a.x + dx * t - plant[0], a.z + dz * t - plant[1]).length() > reach:
						continue
					crossing = minf(crossing, a.y + (b.y - a.y) * t)
				# Not through it, or only grazing what is left of it.
				if crossing >= standing - 0.05 * height:
					continue
				var at := Vector3(plant[0], maxf(0.02, crossing), plant[1])
				var remaining := maxf(0.06, at.y / height)
				if remaining >= standing_cut - 0.01:
					continue
				_set_cut(entry, index, remaining)
				_throw_bits(at, along, speed, kind.leaves, kind.color)
				count += 1
	return count


## An explosion at `at`: everything within `radius` thrown outward with its front, the nearest hardest, then rocking back.
func blast(at: Vector3, power: float = 1.0, radius: float = 5.0) -> void:
	_blasts[_next_blast] = Vector4(at.x, at.z, _time, power)
	_blast_radius[_next_blast] = radius
	_next_blast = (_next_blast + 1) % BLASTS


## The Force from `at` along `direction` (on the ground): a push (power > 0) flattens the cone outward, a pull draws it in.
func gust(at: Vector3, direction: Vector3, range_: float = 6.0, cone: float = 0.95, power: float = 1.3) -> void:
	var dir := Vector2(direction.x, direction.z).normalized()
	_gust_a[_next_gust] = Vector4(at.x, at.z, dir.x, dir.y)
	_gust_b[_next_gust] = Vector4(_time, power, range_, cos(cone))
	_next_gust = (_next_gust + 1) % GUSTS


## Where a blast opened the ground: what grew there is torn off to the stub, thrown up and out. Returns how many.
func uproot(at: Vector3, radius: float) -> int:
	var count := 0
	for x in range(floori((at.x - radius) / CELL), floori((at.x + radius) / CELL) + 1):
		for z in range(floori((at.z - radius) / CELL), floori((at.z + radius) / CELL) + 1):
			for found: Vector2i in _grid.get(Vector2i(x, z), []):
				var entry: Dictionary = entries[found.x]
				var plant: Array = entry.plants[found.y]
				var l := Vector2(plant[0] - at.x, plant[1] - at.z).length()
				if l > radius or entry.cut[found.y] <= 0.06:
					continue
				_set_cut(entry, found.y, 0.0 if l < radius * 0.75 else 0.04 + 0.5 * pow(l / radius, 2.0))
				var along := Vector3(plant[0] - at.x, 0, plant[1] - at.z).normalized()
				var kind: Dictionary = KINDS[entry.kind]
				var y: float = 0.1 + random.call() * plant[4] * 0.5
				_throw_bits(Vector3(plant[0], y, plant[1]), along, 12.0 * (1.0 - l / radius) + 4.0, ceili(kind.leaves / 2.0), kind.color)
				count += 1
	return count


## pushers: [{ x, z, radius, strength }] (the hero, the troopers, the blade's tip).
func update(dt: float, time: float, pushers: Array = [], wind: float = 1.0) -> void:
	_time = time
	# Gusts: the wind gathers and drops.
	var gusting := 0.65 + 0.35 * sin(time * 0.37) * sin(time * 0.13 + 1.0) + 0.25 * maxf(0.0, sin(time * 0.71))
	for i in PUSHERS:
		if i < pushers.size():
			var p: Dictionary = pushers[i]
			_push[i] = Vector4(p.x, p.z, p.radius, p.strength)
		else:
			_push[i] = Vector4.ZERO
	_material.set_shader_parameter("u_time", time)
	_material.set_shader_parameter("u_wind", Vector2(0.13, 0.06) * gusting * wind)
	_material.set_shader_parameter("u_push", _push)
	_material.set_shader_parameter("u_blast", _blasts)
	_material.set_shader_parameter("u_blast_radius", _blast_radius)
	_material.set_shader_parameter("u_gust_a", _gust_a)
	_material.set_shader_parameter("u_gust_b", _gust_b)
	_update_bits(dt)


func reset() -> void:
	for entry in entries:
		for i in entry.plants.size():
			if entry.cut[i] < 1.0:
				_set_cut(entry, i, 1.0)
	_bit_alive.fill(0)
	_blasts.fill(Vector4(0, 0, -99, 0))
	_gust_b.fill(Vector4(-99, 0, 1, 1))


## How many plants of each kind stand, and how many are cut.
func counts() -> Dictionary:
	var result := {}
	for entry in entries:
		if not result.has(entry.kind):
			result[entry.kind] = { "plants": 0, "cut": 0 }
		result[entry.kind].plants += entry.plants.size()
		for value in entry.cut:
			if value < 1.0:
				result[entry.kind].cut += 1
	return result
