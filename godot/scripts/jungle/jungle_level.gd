class_name JungleLevel
extends Node3D
## Stage 2 — the marsh ruins (port of src/jungle.js and src/jungle-map.js). A
## flooded jungle of old ruins, semi open: from the landing at the entry, the
## hero goes where he likes — up the walkways, round by the ruin core, or
## wading through the reeds — to four generators to destroy, each in its core,
## the last in the command post. Each one blown cuts its zone's light.
##
## Baked from the web (assets/baked/jungle.glb: the ruins, walkways, speeder,
## cage, dish, rocks, trees, ivy and the generators; assets/jungle/: the
## ground's paint, the ruins' plating, the water's depth; assets/data/
## jungle.json: the plants, the stones, the lamps, the map's data), it answers
## the game as the lab does (obstacles, posts for the squad, a gate for the
## reinforcements, the generators) and adds its own life:
## - the plants sway, bend away from whoever goes through, are cut by the
##   blade, swept by the Force, blown outward by explosions (Vegetation);
## - the water ripples under every step, wake and body, splashes; the Force
##   drives it; blasts open craters it pours into (JungleWater);
## - soles stay pressed into the sand; the walkways' planks take none;
## - moonlight shafts and lamps light the drifting dust, fireflies (JungleAir);
## - waterfalls pour off the cores' islands.
##
## The ruins' lamps are many: the stage lends a few real lights to the
## nearest of them (the rest glow, unlit).

const LIGHTS := 8
const LIGHT_SCALE := 0.35
const CRATER_CELL := 0.12
const COVER := 1.0
## The glowing materials of a zone, and how bright each burns on (×, before the level).
const GLOWS := ["ruin light strips", "generator core strips", "red diodes", "beacons", "lanterns"]

var data: Dictionary = {}
var bounds: Dictionary = {}
var obstacles: Obstacles
var door: LabDoor
var posts: Array = []
var night := false
var start := { "x": 0.0, "z": 0.0, "heading": 0.0 }
var room: Node3D
var water: JungleWater
var vegetation: Vegetation
var air: JungleAir
var prints: Footprints
var lamps: Array = []
var random: Callable
var _zones := {}
var _lights: Array[OmniLight3D] = []
var _lit: Array = []
var _craters := PackedFloat32Array()
var _crater_columns := 0
var _crater_rows := 0
var _crater_image: Image
var _crater_texture: ImageTexture
var _ground_material: ShaderMaterial
var _cover := PackedFloat32Array()
var _cover_columns := 0
var _cover_rows := 0
var _slabs := ""
var _stones: MultiMesh
var _stone_list: Array = []
var _falls: Array = []
var _force_stirs: Array = []
var _time := 0.0


func _init(dark: bool = false, draw: Callable = Callable()) -> void:
	name = "Jungle"
	night = dark
	random = draw if draw.is_valid() else func() -> float: return randf()


func _ready() -> void:
	data = CombatController._load("res://assets/data/jungle.json")
	bounds = data.bounds
	start = data.start
	obstacles = Obstacles.new(data.obstacles)
	room = (load("res://assets/baked/jungle.glb") as PackedScene).instantiate()
	add_child(room)
	Glow.restore(room, "jungle.glb")
	_dress(room)
	var gate: Dictionary = data.gate.duplicate()
	gate.leaves = []
	door = LabDoor.new(obstacles, gate, Node3D.new())
	for post in data.posts:
		var entry := { "position": Obstacles._vector(post.position), "heading": post.heading }
		if post.has("route"):
			entry.route = post.route.map(func(point: Array) -> Vector3: return Obstacles._vector(point))
		posts.append(entry)
	for lamp in data.lamps:
		lamps.append({ "position": Obstacles._vector(lamp.position), "color": Color(lamp.color[0], lamp.color[1], lamp.color[2]), "base": float(lamp.base), "intensity": float(lamp.base), "zone": lamp.zone })
	_make_ground()
	water = JungleWater.new(bounds, data.water, "res://assets/jungle/depth.bin", data.pads, random)
	add_child(water)
	_ground_material.set_shader_parameter("depth_map", water.depth_texture)
	vegetation = Vegetation.new(data.plants, random)
	add_child(vegetation)
	_make_cover()
	_make_stones()
	_make_falls()
	_slabs = data.slabs.cells
	for k in LIGHTS:
		var light := OmniLight3D.new()
		light.name = "Lamp light"
		light.light_energy = 0.0
		light.omni_range = 6.5
		light.omni_attenuation = 1.7
		light.visible = false
		add_child(light)
		_lights.append(light)
	air = JungleAir.new(bounds, data.shafts, lamps, night, random)
	add_child(air)
	prints = Footprints.new(CombatController._load("res://assets/data/feel.json"), 900, random, { "tint": Color(0.1, 0.075, 0.05), "linger": [240, 300], "name": "Sand footprints" })
	add_child(prints)


## The ruins' plating laid on in world space (2 m to a tile, whatever the block's size); each zone's glowing materials found.
func _dress(root: Node) -> void:
	var plating := StandardMaterial3D.new()
	plating.resource_name = "ruin plating"
	plating.albedo_texture = load("res://assets/jungle/plating.png")
	plating.roughness_texture = load("res://assets/jungle/plating-roughness.png")
	plating.roughness_texture_channel = BaseMaterial3D.TEXTURE_CHANNEL_GREEN
	plating.roughness = 1.0
	plating.metallic = 0.35
	plating.uv1_triplanar = true
	plating.uv1_world_triplanar = true
	plating.uv1_scale = Vector3(0.5, 0.5, 0.5)
	plating.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST_WITH_MIPMAPS
	for mesh: MeshInstance3D in root.find_children("*", "MeshInstance3D", true, false):
		if mesh.mesh == null:
			continue
		for surface in mesh.mesh.get_surface_count():
			var material := mesh.mesh.surface_get_material(surface) as BaseMaterial3D
			if material == null:
				continue
			# Painted in its vertices (the walkways' planks, the speeder, the rocks, the ivy): those colours are its own.
			if mesh.mesh.surface_get_format(surface) & Mesh.ARRAY_FORMAT_COLOR and not material.vertex_color_use_as_albedo:
				material.vertex_color_use_as_albedo = true
			if material.resource_name == "ruin plating":
				mesh.set_surface_override_material(surface, plating)
				continue
			var label := material.resource_name
			var open := label.rfind(" (")
			if open < 0 or not label.ends_with(")"):
				continue
			var base := label.substr(0, open)
			var zone := label.substr(open + 2, label.length() - open - 3)
			if not GLOWS.has(base):
				continue
			if not _zones.has(zone):
				_zones[zone] = { "level": 1.0, "target": 1.0, "stutter": 0.0, "materials": {} }
			_zones[zone].materials[base] = { "material": material, "colour": material.albedo_color }


func _make_ground() -> void:
	var width: float = bounds.maxX - bounds.minX
	var length: float = bounds.maxZ - bounds.minZ
	_crater_columns = ceili(width / CRATER_CELL)
	_crater_rows = ceili(length / CRATER_CELL)
	_craters.resize(_crater_columns * _crater_rows)
	_crater_image = Image.create_from_data(_crater_columns, _crater_rows, false, Image.FORMAT_RF, _craters.to_byte_array())
	_crater_texture = ImageTexture.create_from_image(_crater_image)
	# Fine enough for a crater to be dug in it (a vertex every 16 cm).
	var plane := PlaneMesh.new()
	plane.size = Vector2(width, length)
	plane.subdivide_width = roundi(width * 6.0)
	plane.subdivide_depth = roundi(length * 6.0)
	_ground_material = ShaderMaterial.new()
	_ground_material.shader = load("res://shaders/jungle_ground.gdshader")
	var albedo: Texture2D = load("res://assets/jungle/ground.png")
	_ground_material.set_shader_parameter("albedo_map", albedo)
	_ground_material.set_shader_parameter("roughness_map", load("res://assets/jungle/ground-roughness.png"))
	_ground_material.set_shader_parameter("bump_map", load("res://assets/jungle/ground-bump.png"))
	_ground_material.set_shader_parameter("crater_map", _crater_texture)
	_ground_material.set_shader_parameter("rect_min", Vector2(bounds.minX, bounds.minZ))
	_ground_material.set_shader_parameter("rect_size", Vector2(width, length))
	_ground_material.set_shader_parameter("crater_texel", Vector2(1.0 / _crater_columns, 1.0 / _crater_rows))
	_ground_material.set_shader_parameter("bump_texel", Vector2(1.0 / albedo.get_width(), 1.0 / albedo.get_height()))
	var ground := MeshInstance3D.new()
	ground.name = "Jungle ground"
	ground.mesh = plane
	ground.material_override = _ground_material
	ground.extra_cull_margin = 1.0
	ground.position = Vector3(bounds.minX + width / 2.0, -0.005, bounds.minZ + length / 2.0)
	add_child(ground)


## How thick the cover is on each metre (tall plants), for hiding in it.
func _make_cover() -> void:
	_cover_columns = ceili((bounds.maxX - bounds.minX) / COVER)
	_cover_rows = ceili((bounds.maxZ - bounds.minZ) / COVER)
	_cover.resize(_cover_columns * _cover_rows)
	for kind: String in data.plants:
		var weight := 0.08 if kind == "grass" else (0.5 if kind == "reed" else 0.6)
		for plant: Array in data.plants[kind].plants:
			var i := floori((plant[0] - bounds.minX) / COVER)
			var j := floori((plant[1] - bounds.minZ) / COVER)
			if i >= 0 and j >= 0 and i < _cover_columns and j < _cover_rows:
				_cover[j * _cover_columns + i] += weight * plant[4]


func _make_stones() -> void:
	var shape: Dictionary = data.stones.shape
	var vertices := PackedVector3Array()
	var normals := PackedVector3Array()
	var positions: Array = shape.positions
	for k in positions.size() / 3:
		vertices.append(Vector3(positions[k * 3], positions[k * 3 + 1], positions[k * 3 + 2]))
		normals.append(Vector3(shape.normals[k * 3], shape.normals[k * 3 + 1], shape.normals[k * 3 + 2]))
	# Godot's front faces wind the other way.
	for t in vertices.size() / 3:
		var swap := vertices[t * 3 + 1]
		vertices[t * 3 + 1] = vertices[t * 3 + 2]
		vertices[t * 3 + 2] = swap
		var turn := normals[t * 3 + 1]
		normals[t * 3 + 1] = normals[t * 3 + 2]
		normals[t * 3 + 2] = turn
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	arrays[Mesh.ARRAY_NORMAL] = normals
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	var material := StandardMaterial3D.new()
	material.albedo_color = Color8(0x4a, 0x4a, 0x44)
	material.vertex_color_use_as_albedo = true
	material.roughness = 0.42
	_stones = MultiMesh.new()
	_stones.transform_format = MultiMesh.TRANSFORM_3D
	_stones.use_colors = true
	_stones.mesh = mesh
	_stone_list = data.stones.list
	_stones.instance_count = _stone_list.size()
	_place_stones()
	var instance := MultiMeshInstance3D.new()
	instance.name = "Stones"
	instance.multimesh = _stones
	instance.material_override = material
	add_child(instance)


func _place_stones() -> void:
	for k in _stone_list.size():
		var s: Array = _stone_list[k]
		var basis := Basis(Quaternion(s[3], s[4], s[5], s[6])) * Basis.from_scale(Vector3(s[7], s[8], s[9]))
		_stones.set_instance_transform(k, Transform3D(basis, Vector3(s[0], s[1], s[2])))
		_stones.set_instance_color(k, Color(s[10], s[11], s[12]))


## The waterfalls: a sheet of white water falling off a ruin wall, foam where it lands.
func _make_falls() -> void:
	var material := ShaderMaterial.new()
	material.shader = load("res://shaders/waterfall.gdshader")
	material.render_priority = 3
	for fall in data.falls:
		var at := Obstacles._vector(fall.at)
		var facing := Obstacles._vector(fall.facing)
		var quad := QuadMesh.new()
		quad.size = Vector2(fall.width, fall.height + 0.1)
		var sheet := MeshInstance3D.new()
		sheet.name = "Waterfall"
		sheet.mesh = quad
		sheet.material_override = material
		sheet.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(sheet)
		var middle := Vector3(at.x, fall.height / 2.0, at.z)
		sheet.look_at_from_position(middle, middle - facing, Vector3.UP)
		var pool := ImpactEffects.glow_quad(self, "Waterfall foam")
		pool.position = at + facing * 0.25 + Vector3(0, 0.15, 0)
		pool.scale = Vector3(fall.width * 1.6, 0.6, 1)
		pool.visible = true
		var glow: ShaderMaterial = pool.material_override
		glow.shader = load("res://shaders/glow_mix.gdshader")
		glow.set_shader_parameter("tint", Color(0.55, 0.7, 0.72, 0.55))
		_falls.append({ "at": at, "facing": facing, "width": float(fall.width), "clock": 0.0 })


## The generators: each one's data (socket, approach, facing) and the node its model hangs under.
func generator_specs() -> Array:
	var specs: Array = []
	for g in data.generators:
		specs.append({ "data": g, "room": room.find_child("Generator %s" % g.name, true, false), "name": g.name, "label": g.label, "zone": g.zone })
	return specs


# ---- The map ------------------------------------------------------------------------

static func _to_segment(x: float, z: float, a: Vector3, b: Vector3) -> float:
	var dx := b.x - a.x
	var dz := b.z - a.z
	var t := clampf(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz), 0.0, 1.0)
	return Vector2(x - a.x - dx * t, z - a.z - dz * t).length()


## On a walkway's deck: its height (m), or NAN.
func deck_at(x: float, z: float) -> float:
	for walk in data.walkways:
		if _to_segment(x, z, Obstacles._vector(walk.a), Obstacles._vector(walk.b)) < walk.width / 2.0:
			return data.deck
	return NAN


func on_slabs(x: float, z: float) -> bool:
	var cell: float = data.slabs.cell
	var i := floori((x - bounds.minX) / cell)
	var j := floori((z - bounds.minZ) / cell)
	var columns: int = data.slabs.columns
	if i < 0 or j < 0 or i >= columns or j >= int(data.slabs.rows):
		return false
	return _slabs[j * columns + i] == "1"


func in_water(at: Vector3) -> bool:
	return water.depth(at.x, at.z) > 0.05 and is_nan(deck_at(at.x, at.z))


## How high the ground is at (x, z): a walkway's deck, or below 0 in a crater (m).
func ground_at(x: float, z: float) -> float:
	var deck := deck_at(x, z)
	if not is_nan(deck):
		return deck
	var i := floori((x - bounds.minX) / CRATER_CELL)
	var j := floori((z - bounds.minZ) / CRATER_CELL)
	if i < 0 or j < 0 or i >= _crater_columns or j >= _crater_rows:
		return 0.0
	return minf(0.0, _craters[j * _crater_columns + i])


## For the squad's way-finding: the marsh is slow going (they keep to the walkways and the islands).
func nav_cost(point: Vector3) -> float:
	return 1.0 if not is_nan(deck_at(point.x, point.z)) else 1.0 + 4.0 * water.depth(point.x, point.z)


## How visible the hero is at `at` (1 in the open): down in the water, in among the reeds and ferns, a trooper sees him only closer.
func seen(at: Vector3) -> float:
	var i := floori((at.x - bounds.minX) / COVER)
	var j := floori((at.z - bounds.minZ) / COVER)
	var thick := _cover[j * _cover_columns + i] if i >= 0 and j >= 0 and i < _cover_columns and j < _cover_rows else 0.0
	var wading := smoothstep(0.15, 0.6, water.depth(at.x, at.z)) if is_nan(deck_at(at.x, at.z)) else 0.0
	return minf(1.0 - 0.4 * wading, 1.0 - 0.45 * smoothstep(0.8, 3.0, thick))


# ---- The game's hooks ------------------------------------------------------------------

## A foot comes down: a print in the sand, a splash in the water, nothing on the planks. Returns "water", "wood" or "sand".
func step(at: Vector3, along: Vector3, side: String, size: Array, speed: float = 1.5) -> String:
	if not is_nan(deck_at(at.x, at.z)):
		return "wood"
	if in_water(at):
		water.splash(at, 0.15 + minf(speed, 6.0) * 0.07)
		return "water"
	if not on_slabs(at.x, at.z):
		prints.stamp(at, along, side, 0.85, size)
	return "sand"


## The blade swept: plants in its way are cut; its tip through the water throws it up. Returns plants cut.
func cut(a0: Vector3, b0: Vector3, a1: Vector3, b1: Vector3, speed: float) -> int:
	var count := vegetation.cut(a0, b0, a1, b1, speed)
	if speed > 4.0 and b1.y < water.level + 0.05 and in_water(b1):
		var along := b1 - b0
		along.y = 0.0
		water.splash(b1, minf(1.0, speed / 12.0), along.normalized())
	return count


## Digs a crater at `at`: a bowl `depth` deep, a rim thrown up round it.
func _dig(at: Vector3, radius: float, depth: float) -> void:
	var reach := radius * 1.4
	var ci: float = (at.x - bounds.minX) / CRATER_CELL
	var cj: float = (at.z - bounds.minZ) / CRATER_CELL
	var r := reach / CRATER_CELL
	for j in range(maxi(0, floori(cj - r)), mini(_crater_rows - 1, ceili(cj + r)) + 1):
		for i in range(maxi(0, floori(ci - r)), mini(_crater_columns - 1, ceili(ci + r)) + 1):
			# A little ragged, not a perfect bowl.
			var ragged := 0.88 + 0.24 * (0.5 + 0.5 * sin(i * 0.37 + j * 0.23) * cos(i * 0.19 - j * 0.31))
			var d := Vector2(i + 0.5 - ci, j + 0.5 - cj).length() * CRATER_CELL / (radius * ragged)
			if d > 1.4:
				continue
			var bowl := -depth * pow(1.0 - d * d, 1.4) if d < 1.0 else 0.0
			var rim := depth * 0.3 * exp(-pow((d - 1.0) / 0.2, 2.0))
			var k := j * _crater_columns + i
			_craters[k] = clampf(_craters[k] + bowl + rim * (0.3 if _craters[k] < -0.02 else 1.0), -0.4, 0.09)
	_crater_image.set_data(_crater_columns, _crater_rows, false, Image.FORMAT_RF, _craters.to_byte_array())
	_crater_texture.update(_crater_image)


## A grenade went off at `at`: the plants within its reach thrown outward and torn up where it dug its crater,
## the stones there blown away; the water heaved — blown open if it went off in it, poured into the crater if
## that opened on the bank. Returns the crater's radius.
func blast(at: Vector3, power: float = 1.0, reach: float = 5.0) -> float:
	var radius := 0.9 + 0.35 * power
	var wet := in_water(at)
	if is_nan(deck_at(at.x, at.z)):
		_dig(at, radius, (0.12 if wet else 0.17) * power)
	vegetation.blast(at, 1.6 * power, reach)
	vegetation.uproot(at, radius * 0.95)
	for k in _stone_list.size():
		var s: Array = _stone_list[k]
		if Vector2(s[0] - at.x, s[2] - at.z).length() < radius:
			_stones.set_instance_transform(k, Transform3D(Basis.from_scale(Vector3.ZERO), Vector3.ZERO))
	water.disturb(at.x, at.z, minf(3.0, reach * 0.6), 0.05 * power)
	if wet:
		water.splash(at, 2.0 * power)
	water.crater(at, radius)
	return radius


## The Force from the hero at `at` along `direction`: through the plants and the water in its cone — a push
## drives them out, a pull draws them in — and the dust in the air with them.
func force(kind: String, at: Vector3, direction: Vector3, range_: float = 6.0, cone: float = 0.95) -> void:
	var push := kind == "push"
	var dir := Vector3(direction.x, 0, direction.z).normalized()
	vegetation.gust(at, dir, range_ * 1.15, cone + 0.1, 1.5 if push else -1.15)
	water.shove(at, dir, range_ * 1.2, cone + 0.1, 1.0 if push else -0.85)
	for n in range(1, 6):
		var point := at + dir * (n * range_ / 5.0)
		_force_stirs.append({ "at": Vector3(point.x, 0.9, point.z), "speed": 9.0 if push else 6.0, "life": 0.25 + n * 0.05 })


## A bolt into the floor at `at`: into the water, a splash. True if it was water.
func bolt(at: Vector3) -> bool:
	if not in_water(at):
		return false
	water.splash(at, 0.45)
	return true


## A body landing at `at`: in the water, a big splash.
func landing(at: Vector3, speed: float) -> void:
	if in_water(at):
		water.splash(at, clampf(speed / 5.0, 0.4, 1.6))


## A generator blown: its zone's light dies (with a last stutter).
func sabotaged(zone: String) -> void:
	set_zone(zone, 0.0)


func set_zone(zone: String, level: float) -> void:
	if not _zones.has(zone):
		for lamp in lamps:
			if lamp.zone == zone:
				lamp.intensity = lamp.base * level
		return
	var entry: Dictionary = _zones[zone]
	if level < entry.target:
		entry.stutter = 0.45
	entry.target = level


## The diodes blink; each zone's light follows its level; the lamps lit nearest the focus get the real lights.
func _ruins_step(time: float, dt: float) -> void:
	var on := 0.55 + 0.45 * sin(time * 2.1) * sin(time * 0.7 + 1.0)
	for zone: String in _zones:
		var entry: Dictionary = _zones[zone]
		if entry.stutter > 0.0:
			entry.stutter -= dt
		entry.level = entry.target + 0.6 * (1.0 - entry.target) if entry.stutter > 0.0 and sin(time * 60.0) > 0.2 else entry.target
		var k: float = entry.level
		for base: String in entry.materials:
			var glow: Dictionary = entry.materials[base]
			var scale := k
			match base:
				"lanterns":
					scale = 0.06 + 0.94 * k
				"generator core strips":
					scale = 0.04 + 0.96 * k
				"beacons":
					scale = (0.1 + 0.9 * k) * (1.0 if sin(time * 3.2) > -0.3 else 0.15)
				"red diodes":
					scale = (0.45 + 0.55 * on) * (0.3 + 0.7 * k)
			var colour: Color = glow.colour
			glow.material.albedo_color = Color(colour.r * scale, colour.g * scale, colour.b * scale, colour.a)
		for lamp in lamps:
			if lamp.zone == zone:
				lamp.intensity = lamp.base * k


func _lend_lights(focus: Vector3) -> void:
	_lit = lamps.filter(func(lamp: Dictionary) -> bool: return lamp.intensity > 0.05)
	_lit.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return a.position.distance_squared_to(focus) < b.position.distance_squared_to(focus))
	for i in LIGHTS:
		var light := _lights[i]
		if i >= _lit.size():
			light.light_energy = 0.0
			light.visible = false
			continue
		var lamp: Dictionary = _lit[i]
		light.position = lamp.position
		light.light_color = lamp.color
		# Faded in by distance, so that one changing hands far off is not seen to.
		var far: float = lamp.position.distance_to(focus)
		light.light_energy = lamp.intensity * clampf((18.0 - far) / 4.0, 0.0, 1.0) * LIGHT_SCALE
		light.visible = light.light_energy > 1e-4


## Each frame. actors: who goes through the plants and the water ({ x, z, radius, strength, speed, wades });
## stirs: what moves through the air; lights: the lights burning now (the blade), for the water's glints.
func update(dt: float, time: float, focus: Vector3, actors: Array = [], stirs: Array = [], lights: Array = []) -> void:
	_time = time
	_ruins_step(time, dt)
	_lend_lights(focus)
	# What glints on the water: the lights burning now (the blade, a blast), then the lamps lit nearest the view.
	var glints: Array = []
	for light: Light3D in lights:
		if light.visible and light.light_energy > 0.05 * LIGHT_SCALE:
			glints.append({ "position": light.global_position, "color": light.light_color * minf(2.5, light.light_energy / LIGHT_SCALE / 5.0) })
	for lamp in _lit:
		glints.append({ "position": lamp.position, "color": lamp.color * minf(2.5, lamp.intensity / 5.0) })
	water.set_glints(glints.slice(0, JungleWater.GLINTS))
	vegetation.update(dt, time, actors)
	var waders := actors.filter(func(actor: Dictionary) -> bool: return actor.get("wades", true) and is_nan(deck_at(actor.x, actor.z)))
	water.update(dt, waders)
	# The waterfalls stir the water where they land, and spatter it.
	for fall in _falls:
		var at: Vector3 = fall.at
		var facing: Vector3 = fall.facing
		var x := at.x + facing.x * 0.3
		var z := at.z + facing.z * 0.3
		var across: float = (random.call() - 0.5) * fall.width
		water.disturb(x + facing.z * across, z - facing.x * across, 0.2, 0.012)
		fall.clock -= dt
		if fall.clock <= 0.0:
			fall.clock = 0.1 + random.call() * 0.12
			water.splash(Vector3(x + facing.z * across, 0, z - facing.x * across), 0.25, facing)
	for n in range(_force_stirs.size() - 1, -1, -1):
		_force_stirs[n].life -= dt
		if _force_stirs[n].life <= 0.0:
			_force_stirs.remove_at(n)
	air.update(dt, time, stirs + _force_stirs)
	prints.update(dt)


func reset() -> void:
	vegetation.reset()
	water.reset()
	prints.clear()
	door.reset()
	_craters.fill(0.0)
	_crater_image.set_data(_crater_columns, _crater_rows, false, Image.FORMAT_RF, _craters.to_byte_array())
	_crater_texture.update(_crater_image)
	_place_stones()
	_force_stirs.clear()
	for zone: String in _zones:
		_zones[zone].target = 1.0
		_zones[zone].level = 1.0
		_zones[zone].stutter = 0.0
	for lamp in lamps:
		lamp.intensity = lamp.base
