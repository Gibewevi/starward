class_name SaberScars
extends Node3D
## The blade's marks on the room (port of src/saber-scars.js). Wherever the
## lit blade goes into a case, a wall, a barrel or the floor, the line where
## it meets the surface melts: a molten trail is drawn along the surface as
## the blade moves — white-hot, then orange, then red, dimming out over about
## five seconds — and the cut (a black groove, heat-tinted lips) stays there
## for good (the oldest are recycled after a few thousand).
##
## Each frame cut(base, tip) clips the blade against every obstacle (a barrel
## as a cylinder) and the floor: the points where it enters and leaves a
## surface, joined to where they were the frame before on the same face, are
## the strokes. update(dt) cools the trails. Contacts are reported back
## (sparks are the game's business).

const HOT := Color(2.6, 0.75, 0.12)
const RED_HOT := Color(0.8, 0.06, 0.012)

var obstacles: Obstacles
var bounds: Dictionary
var floor_height := 0.0
var contacts: Array = []
var _scars: MultiMesh
var _glows: MultiMesh
var _ages := PackedFloat32Array()
var _next_scar := 0
var _next_glow := 0
var _previous := {}
var _current := {}


func _init(level: Obstacles = null, room: Dictionary = {}, scar_max: int = 3000, glow_max: int = 700) -> void:
	name = "Saber scars"
	obstacles = level
	bounds = room
	var quad := QuadMesh.new()
	quad.size = Vector2(1, 1)
	# A cut reads on dark steel as a black groove with heat-tinted lips.
	var scar := StandardMaterial3D.new()
	scar.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	scar.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	scar.cull_mode = BaseMaterial3D.CULL_DISABLED
	scar.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	scar.albedo_texture = scar_texture()
	scar.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR
	scar.render_priority = 2
	_scars = _instances("Saber cuts", quad, scar, scar_max, false)
	var glow := ShaderMaterial.new()
	glow.shader = load("res://shaders/floor_glow.gdshader")
	glow.set_shader_parameter("map", line_glow_texture())
	glow.render_priority = 3
	_glows = _instances("Molten saber trails", quad, glow, glow_max, true)
	_ages.resize(glow_max)
	_ages.fill(INF)


func _instances(label: String, mesh: Mesh, material: Material, count: int, colours: bool) -> MultiMesh:
	var multimesh := MultiMesh.new()
	multimesh.transform_format = MultiMesh.TRANSFORM_3D
	multimesh.use_colors = colours
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
	return multimesh


## Across the cut: a black groove, lips of heat-tinted steel (bronze to blue-grey), soft edges; ends fade.
static func scar_texture() -> ImageTexture:
	var w := 32
	var h := 32
	var image := Image.create(w, h, false, Image.FORMAT_RGBA8)
	for y in h:
		for x in w:
			var across := absf((x + 0.5) / w * 2.0 - 1.0)
			var along := (y + 0.5) / h
			var ends := smoothstep(0.0, 0.12, along) * smoothstep(0.0, 0.12, 1.0 - along)
			var groove := across < 0.28
			var lip := across < 0.7
			var rgb := [6, 5, 5] if groove else ([roundi(128 - across * 70), roundi(92 - across * 36), roundi(62 + across * 14)] if lip else [0, 0, 0])
			var alpha := 245.0 if groove else (roundf(175.0 * (1.0 - (across - 0.28) / 0.42)) if lip else 0.0)
			image.set_pixel(x, y, Color8(rgb[0], rgb[1], rgb[2], roundi(alpha * ends)))
	return ImageTexture.create_from_image(image)


## A soft line of light (kit.js's lineGlowTexture): bright along its middle, fading across and at both ends.
static func line_glow_texture() -> ImageTexture:
	var w := 32
	var h := 64
	var image := Image.create(w, h, false, Image.FORMAT_RGBA8)
	for y in h:
		for x in w:
			var across := absf((x + 0.5) / w * 2.0 - 1.0)
			var along := (y + 0.5) / h
			var ends := smoothstep(0.0, 0.14, along) * smoothstep(0.0, 0.14, 1.0 - along)
			image.set_pixel(x, y, Color8(255, 255, 255, roundi(pow(1.0 - across, 2.4) * ends * 255.0)))
	return ImageTexture.create_from_image(image)


## A stroke from a to b on a surface of normal `normal`.
func _stroke(a: Vector3, b: Vector3, normal: Vector3) -> void:
	var along := b - a
	var length := along.length()
	if length < 1e-4:
		along = normal.cross(Vector3.UP if absf(normal.y) < 0.9 else Vector3.RIGHT).normalized()
		length = 0.0
	else:
		along /= length
	var across := along.cross(normal).normalized()
	var centre := (a + b) * 0.5 + normal * 0.005
	# The cut: thin and dark, a little longer than the stroke so strokes join.
	_scars.set_instance_transform(_next_scar, Transform3D(Basis(across * 0.07, along * (length + 0.04), normal), centre))
	_next_scar = (_next_scar + 1) % _scars.instance_count
	_scars.visible_instance_count = mini(_scars.instance_count, _scars.visible_instance_count + 1)
	# The molten trail over it, wider and soft, cooling from now.
	_ages[_next_glow] = 0.0
	_glows.set_instance_transform(_next_glow, Transform3D(Basis(across * 0.13, along * (length + 0.1), normal), centre + normal * 0.002))
	_glows.set_instance_color(_next_glow, Color(3.2, 2.0, 1.1))
	_next_glow = (_next_glow + 1) % _glows.instance_count
	_glows.visible_instance_count = mini(_glows.instance_count, _glows.visible_instance_count + 1)


func _touch(key: String, point: Vector3, normal: Vector3) -> void:
	var before: Variant = _previous.get(key)
	_current[key] = point
	if before != null and (before as Vector3).distance_to(point) < 0.5:
		_stroke(before, point, normal)
	else:
		_stroke(point, point, normal)
	contacts.append({ "point": point, "normal": normal, "fresh": before == null })


## The lit blade from base to tip this frame: marks where it goes into things;
## the floor only when `on_floor` (a strike, not the blade held low while
## walking). Returns the contacts.
func cut(base: Vector3, tip: Vector3, on_floor: bool = true) -> Array:
	contacts = []
	_current = {}
	var a := base
	var d := tip - base
	if obstacles:
		for index in obstacles.boxes.size():
			var box: Dictionary = obstacles.boxes[index]
			if box.kind == "rail":
				continue
			if box.kind == "barrel":
				_barrel(index, box, a, d)
				continue
			# Slab clip of the blade against the box: where it enters and leaves.
			var enter := 0.0
			var leave := 1.0
			var enter_axis := -1
			var enter_sign := 0
			var leave_axis := -1
			var leave_sign := 0
			var inside := true
			for axis in 3:
				var o: float = a[axis]
				var v: float = d[axis]
				var lo: float = box.min[axis]
				var hi: float = box.max[axis]
				if absf(v) < 1e-9:
					if o < lo or o > hi:
						inside = false
						break
					continue
				var t0 := (lo - o) / v
				var t1 := (hi - o) / v
				var s0 := -1
				var s1 := 1
				if t0 > t1:
					var swap := t0
					t0 = t1
					t1 = swap
					s0 = 1
					s1 = -1
				if t0 > enter:
					enter = t0
					enter_axis = axis
					enter_sign = s0
				if t1 < leave:
					leave = t1
					leave_axis = axis
					leave_sign = s1
				if enter > leave:
					inside = false
					break
			if not inside:
				continue
			if enter_axis >= 0 and enter > 0.0:
				var normal := Vector3.ZERO
				normal[enter_axis] = enter_sign
				_touch("%d:in:%d%d" % [index, enter_axis, enter_sign], a + d * enter, normal)
			if leave_axis >= 0 and leave < 1.0:
				var normal := Vector3.ZERO
				normal[leave_axis] = leave_sign
				_touch("%d:out:%d%d" % [index, leave_axis, leave_sign], a + d * leave, normal)
	# The floor.
	if on_floor and (a.y - floor_height) * (a.y + d.y - floor_height) < 0.0:
		var point := a + d * ((a.y - floor_height) / -d.y)
		if bounds.is_empty() or (point.x > bounds.minX and point.x < bounds.maxX and point.z > bounds.minZ and point.z < bounds.maxZ):
			_touch("floor", point, Vector3.UP)
	_previous = _current
	return contacts


## A barrel is round: the blade meets its curved side (or its lid).
func _barrel(index: int, box: Dictionary, a: Vector3, d: Vector3) -> void:
	var low: Vector3 = box.min
	var high: Vector3 = box.max
	var r := (high.x - low.x) / 2.0
	var cx := (low.x + high.x) / 2.0
	var cz := (low.z + high.z) / 2.0
	var ox := a.x - cx
	var oz := a.z - cz
	var qa := d.x * d.x + d.z * d.z
	var qb := 2.0 * (ox * d.x + oz * d.z)
	var qc := ox * ox + oz * oz - r * r
	var hits: Array = []
	if qa > 1e-9:
		var disc := qb * qb - 4.0 * qa * qc
		if disc >= 0.0:
			for t in [(-qb - sqrt(disc)) / (2.0 * qa), (-qb + sqrt(disc)) / (2.0 * qa)]:
				if t <= 0.0 or t >= 1.0:
					continue
				var p: Vector3 = a + d * t
				if p.y < low.y or p.y > high.y:
					continue
				hits.append([p, Vector3(p.x - cx, 0, p.z - cz).normalized()])
	# Through the lid.
	if absf(d.y) > 1e-9:
		var t := (high.y - a.y) / d.y
		var p := a + d * t
		if t > 0.0 and t < 1.0 and pow(p.x - cx, 2.0) + pow(p.z - cz, 2.0) < r * r:
			hits.append([p, Vector3.UP])
	for k in hits.size():
		_touch("%d:barrel:%d" % [index, k], hits[k][0], hits[k][1])


## The trails cool: white-hot, orange, red, out.
func update(dt: float) -> void:
	for i in _glows.visible_instance_count:
		if _ages[i] == INF:
			continue
		_ages[i] += dt
		var t := _ages[i]
		var colour: Color
		if t > 5.0:
			_ages[i] = INF
			colour = Color(0, 0, 0)
		elif t < 0.12:
			colour = Color(3.2, 2.0, 1.1).lerp(HOT, t / 0.12)
		elif t < 1.1:
			colour = HOT.lerp(RED_HOT, (t - 0.12) / 0.98)
		else:
			var fade := pow(1.0 - smoothstep(1.1, 5.0, t), 1.3)
			colour = Color(RED_HOT.r * fade, RED_HOT.g * fade, RED_HOT.b * fade)
		_glows.set_instance_color(i, colour)


func clear() -> void:
	_scars.visible_instance_count = 0
	_glows.visible_instance_count = 0
	_next_scar = 0
	_next_glow = 0
	_ages.fill(INF)
	_previous = {}


func scars() -> int:
	return _scars.visible_instance_count


func glowing() -> int:
	var count := 0
	for age in _ages:
		if age < 5.0:
			count += 1
	return count
