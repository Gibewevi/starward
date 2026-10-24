class_name ScorchMarks
extends Node3D
## Burn marks that stay (port of src/scorch-marks.js). A blast leaves a
## ragged star of soot on the floor, tempered-steel brown around it, and black
## licks up the sides of the crates, barriers and barrels that stood near it;
## a bolt leaves a small scorch wherever it strikes, on the floor or on a
## crate (on a barrel, on its curve). Nothing fades: the oldest marks are only
## recycled once there are hundreds.
##
## The textures are the web's own, painted by its code and cooked as PNG
## (assets/fx/scorch-*.png). Every kind of mark is one MultiMesh, so a room
## covered in scorches costs a few draw calls.

var obstacles: Obstacles
var random: Callable
var floor_burns: Dictionary
var walls: Dictionary
var barrels: Dictionary
var bolts: Dictionary


func _init(level: Obstacles = null, draw: Callable = Callable(), floor_max: int = 24, wall_max: int = 48, bolt_max: int = 260) -> void:
	name = "Scorch marks"
	obstacles = level
	random = draw if draw.is_valid() else func() -> float: return randf()
	var unit := QuadMesh.new()
	unit.size = Vector2(1, 1)
	# Wall soot: its origin at the bottom of the mark, on the floor.
	var standing := QuadMesh.new()
	standing.size = Vector2(1, 1)
	standing.center_offset = Vector3(0, 0.5, 0)
	floor_burns = _decals(unit, "res://assets/fx/scorch-floor.png", floor_max, "Blast burns")
	walls = _decals(standing, "res://assets/fx/scorch-walls.png", wall_max, "Blast soot")
	barrels = _decals(_curve(), "res://assets/fx/scorch-barrels.png", ceili(wall_max / 2.0), "Blast soot (barrels)")
	bolts = _decals(unit, "res://assets/fx/scorch-bolts.png", bolt_max, "Bolt scorches")


## A third of a cylinder of radius 1 and height 1 (from the floor up), centred on +Z.
static func _curve() -> ArrayMesh:
	var segments := 14
	var start := -PI / 3.2
	var length := PI / 1.6
	var vertices := PackedVector3Array()
	var normals := PackedVector3Array()
	var uvs := PackedVector2Array()
	for k in segments:
		var corners := []
		for j in [k, k + 1]:
			var theta: float = start + length * j / segments
			var side := Vector3(sin(theta), 0, cos(theta))
			corners.append([side, j / float(segments)])
		var a: Vector3 = corners[0][0]
		var b: Vector3 = corners[1][0]
		var ua: float = corners[0][1]
		var ub: float = corners[1][1]
		for vertex in [[a + Vector3.UP, a, Vector2(ua, 0)], [a, a, Vector2(ua, 1)], [b, b, Vector2(ub, 1)], [a + Vector3.UP, a, Vector2(ua, 0)], [b, b, Vector2(ub, 1)], [b + Vector3.UP, b, Vector2(ub, 0)]]:
			vertices.append(vertex[0])
			normals.append(vertex[1])
			uvs.append(vertex[2])
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_TEX_UV] = uvs
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return mesh


func _decals(mesh: Mesh, texture_path: String, count: int, label: String) -> Dictionary:
	var material := StandardMaterial3D.new()
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	material.cull_mode = BaseMaterial3D.CULL_DISABLED
	material.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	material.vertex_color_use_as_albedo = true
	material.albedo_texture = load(texture_path)
	material.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR
	material.render_priority = 1
	var multimesh := MultiMesh.new()
	multimesh.transform_format = MultiMesh.TRANSFORM_3D
	multimesh.use_colors = true
	multimesh.mesh = mesh
	multimesh.instance_count = count
	multimesh.visible_instance_count = 0
	var instance := MultiMeshInstance3D.new()
	instance.name = label
	instance.multimesh = multimesh
	instance.material_override = material
	instance.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	instance.extra_cull_margin = 64.0
	add_child(instance)
	return { "multimesh": multimesh, "next": 0, "max": count }


func _add(decals: Dictionary, transform: Transform3D, darkness: float = 1.0) -> void:
	var multimesh: MultiMesh = decals.multimesh
	multimesh.set_instance_transform(decals.next, transform)
	multimesh.set_instance_color(decals.next, Color(darkness, darkness, darkness, 1))
	decals.next = (decals.next + 1) % decals.max
	multimesh.visible_instance_count = mini(decals.max, multimesh.visible_instance_count + 1)


## A flat mark lying on a surface of normal `normal`, turned by `angle` about it.
func _flat(decals: Dictionary, at: Vector3, normal: Vector3, size: float, angle: float, lift: float, darkness: float) -> void:
	var turn := Quaternion(Vector3(0, 0, 1), normal) * Quaternion(Vector3(0, 0, 1), angle)
	_add(decals, Transform3D(Basis(turn) * Basis.from_scale(Vector3(size, size, 1)), at + normal * lift), darkness)


## Soot standing on the floor against an upright face of normal `normal`.
func _upright(decals: Dictionary, base: Vector3, normal: Vector3, width: float, height: float, darkness: float) -> void:
	var across := Vector3.UP.cross(normal).normalized()
	_add(decals, Transform3D(Basis(across * width, Vector3.UP * height, normal), base), darkness)


## A blast on the floor at `at`: its burn, and soot on what stood around it.
func blast(at: Vector3, power: float = 1.0) -> void:
	_flat(floor_burns, Vector3(at.x, 0, at.z), Vector3.UP, (2.0 + random.call() * 0.5) * power, random.call() * TAU, 0.004, 0.85 + random.call() * 0.15)
	if obstacles == null:
		return
	var reach := 1.7 * power
	for box in obstacles.boxes:
		var low: Vector3 = box.min
		var high: Vector3 = box.max
		if low.y > 0.3 or box.kind == "rail":
			continue
		var distance := Vector2(at.x - clampf(at.x, low.x, high.x), at.z - clampf(at.z, low.z, high.z)).length()
		if distance > reach:
			continue
		var strength := 1.0 - distance / reach
		var tall := high.y - low.y
		if box.kind == "barrel":
			# On its curve, centred on the side facing the blast.
			var radius := (high.x - low.x) / 2.0 + 0.012
			var centre: Vector3 = box.centre
			var facing := atan2(at.x - centre.x, at.z - centre.z)
			var basis := Basis(Vector3.UP, facing) * Basis.from_scale(Vector3(radius, minf(tall, 0.45 + 0.75 * strength), radius))
			_add(barrels, Transform3D(basis, Vector3(centre.x, low.y, centre.z)), 0.75 + 0.25 * strength)
			continue
		# Every face that sees the blast: soot rising from the floor, as wide as the blast reached.
		for face in [[0, 1], [0, -1], [2, 1], [2, -1]]:
			var axis: int = face[0]
			var side: float = face[1]
			var plane: float = high[axis] if side > 0 else low[axis]
			var away: float = (at[axis] - plane) * side
			if away < -0.05 or away > reach:
				continue
			var along := 2 if axis == 0 else 0
			var span: float = high[along] - low[along]
			var width := minf(span, (0.9 + 1.3 * strength) * power * (0.85 + random.call() * 0.3))
			var middle := clampf(at[along], low[along] + width / 2.0, high[along] - width / 2.0)
			var normal := Vector3.ZERO
			normal[axis] = side
			var base := Vector3(0, low.y, 0)
			base[axis] = plane + side * 0.014
			base[along] = middle
			var near := 1.0 - maxf(0.0, away) / reach
			_upright(walls, base, normal, width, minf(tall, (0.45 + 0.8 * near) * power), 0.7 + 0.3 * near)


## A bolt struck at `at`, on a surface of normal `normal` (the floor, a crate, a barrel's box); returns where the mark went.
func bolt(at: Vector3, normal: Vector3, box: Variant = null) -> Dictionary:
	var surface := normal
	var where := at
	if box != null and box.kind == "barrel" and absf(normal.y) < 0.5:
		# A barrel is round: the scorch goes on its curve, not on its bounding box.
		var radius: float = (box.max.x - box.min.x) / 2.0
		surface = Vector3(at.x - box.centre.x, 0, at.z - box.centre.z)
		if surface.length_squared() < 1e-8:
			surface = normal
		surface = surface.normalized()
		where = Vector3(box.centre.x, at.y, box.centre.z) + surface * radius
	_flat(bolts, where, surface, 0.17 + random.call() * 0.1, random.call() * TAU, 0.005, 0.8 + random.call() * 0.2)
	return { "position": where, "normal": surface }


func clear() -> void:
	for decals in [floor_burns, walls, barrels, bolts]:
		decals.multimesh.visible_instance_count = 0
		decals.next = 0


func count() -> int:
	var total := 0
	for decals in [floor_burns, walls, barrels, bolts]:
		total += decals.multimesh.visible_instance_count
	return total
