class_name JungleWater
extends Node3D
## The marsh's shallow water (port of src/water.js): clear over the sand,
## darker where it is deep, a line of foam along the edge.
##
## Its surface is a real wave simulation on a fine grid (the wave equation,
## damped), run on the graphics card (shaders/water_step.glsl): anything that
## disturbs it — a step, someone wading through, a body falling in, a bolt,
## an explosion — pushes the water there, and the rings spread, cross, bounce
## off the banks and die away. Water heaped up against a bank spills over it
## as a thin sheet. The ripples catch the moon and the lamps of the ruins as
## moving glints (shaders/jungle_water.gdshader). Lily pads ride the waves. A
## splash throws drops that fall back into it.
##
## The Force moves it (shove): a push drives a wall of water out across the
## cone before the hero, a pull draws it towards him. An explosion in the
## water blows a hole in it the water rushes back into, meeting in a jet; one
## on the bank opens a crater the stream pours into (crater).
##
## Without a graphics card to run it on (a check without a window), the water
## lies still; everything else about it (its depth, the splashes) still works.

const GLINTS := 6
const SHAPE := 0.6
const DROPS := 500
const MAX_PUSHES := 96

var bounds: Dictionary
var cell := 0.12
var columns := 0
var rows := 0
var level := 0.035
var random: Callable
## How deep it is in each cell (0 dry → 1), rows along +z; craters flood it.
var mask := PackedFloat32Array()
var _first_mask := PackedFloat32Array()
var _depth_image: Image
var depth_texture: ImageTexture
var height_texture := Texture2DRD.new()
var _surface: MeshInstance3D
var _material: ShaderMaterial
var _pads: MultiMeshInstance3D
var _drops: MeshInstance3D
var _drop_p := PackedVector3Array()
var _drop_v := PackedVector3Array()
var _drop_age := PackedFloat32Array()
var _drop_alive := PackedByteArray()
var _next_drop := 0
var _pushes: Array = []
var _shoves: Array = []
var _rushes: Array = []
var _accumulator := 0.0
var _mask_changed := false
# The graphics card's side.
var _rd: RenderingDevice
var _shader := RID()
var _pipeline := RID()
var _state := RID()
var _next := RID()
var _mask := RID()
var _buffer := RID()
var _set := RID()
var _ready_gpu := false


func _init(rect: Dictionary, data: Dictionary, depth_path: String, pads: Array, draw: Callable = Callable()) -> void:
	name = "Jungle water"
	bounds = rect
	cell = data.cell
	columns = int(data.columns)
	rows = int(data.rows)
	level = data.level
	random = draw if draw.is_valid() else func() -> float: return randf()
	var bytes := FileAccess.get_file_as_bytes(depth_path)
	mask = bytes.to_float32_array()
	if mask.size() != columns * rows:
		mask.resize(columns * rows)
	_first_mask = mask.duplicate()
	_depth_image = Image.create_from_data(columns, rows, false, Image.FORMAT_RF, mask.to_byte_array())
	depth_texture = ImageTexture.create_from_image(_depth_image)
	var width: float = bounds.maxX - bounds.minX
	var length: float = bounds.maxZ - bounds.minZ
	# Fine enough for the surface to take the shape of the waves (a vertex every 16 cm).
	var plane := PlaneMesh.new()
	plane.size = Vector2(width, length)
	plane.subdivide_width = roundi(width / 0.16)
	plane.subdivide_depth = roundi(length / 0.16)
	_material = ShaderMaterial.new()
	_material.shader = load("res://shaders/jungle_water.gdshader")
	_material.set_shader_parameter("height_map", height_texture)
	_material.set_shader_parameter("depth_map", depth_texture)
	_material.set_shader_parameter("texel", Vector2(1.0 / columns, 1.0 / rows))
	_material.set_shader_parameter("rect_min", Vector2(bounds.minX, bounds.minZ))
	_material.set_shader_parameter("rect_size", Vector2(width, length))
	_material.render_priority = 2
	_surface = MeshInstance3D.new()
	_surface.name = "Surface"
	_surface.mesh = plane
	_surface.material_override = _material
	_surface.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_surface.extra_cull_margin = 4.0
	_surface.position = Vector3(bounds.minX + width / 2.0, level, bounds.minZ + length / 2.0)
	add_child(_surface)
	_make_pads(pads)
	_make_drops()
	set_glints([])


func _ready() -> void:
	_rd = RenderingServer.get_rendering_device()
	if _rd == null:
		return
	RenderingServer.call_on_render_thread(_start_gpu)


func _exit_tree() -> void:
	if _rd and _ready_gpu:
		var rd := _rd
		var rids := [_set, _buffer, _mask, _next, _state, _pipeline, _shader]
		_ready_gpu = false
		height_texture.texture_rd_rid = RID()
		RenderingServer.call_on_render_thread(func() -> void:
			for rid: RID in rids:
				if rid.is_valid():
					rd.free_rid(rid))


func _start_gpu() -> void:
	var source: RDShaderFile = load("res://shaders/water_step.glsl")
	_shader = _rd.shader_create_from_spirv(source.get_spirv())
	if not _shader.is_valid():
		return
	_pipeline = _rd.compute_pipeline_create(_shader)
	var format := RDTextureFormat.new()
	format.width = columns
	format.height = rows
	format.format = RenderingDevice.DATA_FORMAT_R32G32B32A32_SFLOAT
	format.usage_bits = RenderingDevice.TEXTURE_USAGE_STORAGE_BIT | RenderingDevice.TEXTURE_USAGE_SAMPLING_BIT | RenderingDevice.TEXTURE_USAGE_CAN_UPDATE_BIT | RenderingDevice.TEXTURE_USAGE_CAN_COPY_FROM_BIT | RenderingDevice.TEXTURE_USAGE_CAN_COPY_TO_BIT
	var empty := PackedFloat32Array()
	empty.resize(columns * rows * 4)
	_state = _rd.texture_create(format, RDTextureView.new(), [empty.to_byte_array()])
	_next = _rd.texture_create(format, RDTextureView.new(), [empty.to_byte_array()])
	var single := RDTextureFormat.new()
	single.width = columns
	single.height = rows
	single.format = RenderingDevice.DATA_FORMAT_R32_SFLOAT
	single.usage_bits = RenderingDevice.TEXTURE_USAGE_STORAGE_BIT | RenderingDevice.TEXTURE_USAGE_CAN_UPDATE_BIT
	_mask = _rd.texture_create(single, RDTextureView.new(), [mask.to_byte_array()])
	var pushes := PackedFloat32Array()
	pushes.resize(MAX_PUSHES * 12)
	_buffer = _rd.storage_buffer_create(pushes.size() * 4, pushes.to_byte_array())
	var uniforms: Array[RDUniform] = []
	for binding in 4:
		var uniform := RDUniform.new()
		uniform.binding = binding
		uniform.uniform_type = RenderingDevice.UNIFORM_TYPE_STORAGE_BUFFER if binding == 3 else RenderingDevice.UNIFORM_TYPE_IMAGE
		uniform.add_id([_state, _next, _mask, _buffer][binding])
		uniforms.append(uniform)
	_set = _rd.uniform_set_create(uniforms, _shader, 0)
	_ready_gpu = true
	_link.call_deferred()


## The surface and the pads read the waves straight from the graphics card.
func _link() -> void:
	height_texture.texture_rd_rid = _state


## A step of the waves on the graphics card: this step's pushes, then the next state, copied back.
func _gpu_step(pushes: PackedFloat32Array, count: int, new_mask: PackedByteArray) -> void:
	if not _ready_gpu:
		return
	if not new_mask.is_empty():
		_rd.texture_update(_mask, 0, new_mask)
	if count > 0:
		_rd.buffer_update(_buffer, 0, pushes.size() * 4, pushes.to_byte_array())
	var groups := Vector2i(ceili(columns / 8.0), ceili(rows / 8.0))
	for pass_index in 2:
		if pass_index == 0 and count == 0:
			continue
		var params := PackedInt32Array([columns, rows, pass_index, count]).to_byte_array()
		params.append_array(PackedFloat32Array([bounds.minX, bounds.minZ, cell, 0.0]).to_byte_array())
		var list := _rd.compute_list_begin()
		_rd.compute_list_bind_compute_pipeline(list, _pipeline)
		_rd.compute_list_bind_uniform_set(list, _set, 0)
		_rd.compute_list_set_push_constant(list, params, params.size())
		_rd.compute_list_dispatch(list, groups.x, groups.y, 1)
		_rd.compute_list_end()
	_rd.texture_copy(_next, _state, Vector3.ZERO, Vector3.ZERO, Vector3(columns, rows, 1), 0, 0, 0, 0)


func _make_pads(pads: Array) -> void:
	var shape := ArrayMesh.new()
	var vertices := PackedVector3Array()
	# A disc with a notch, flat on the water.
	var segments := 12
	var start := 0.35
	var sweep := TAU - 0.7
	for k in segments:
		var a := start + sweep * k / segments
		var b := start + sweep * (k + 1) / segments
		vertices.append_array([Vector3.ZERO, Vector3(cos(b), 0, -sin(b)), Vector3(cos(a), 0, -sin(a))])
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	var normals := PackedVector3Array()
	normals.resize(vertices.size())
	normals.fill(Vector3.UP)
	arrays[Mesh.ARRAY_NORMAL] = normals
	shape.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	var multimesh := MultiMesh.new()
	multimesh.transform_format = MultiMesh.TRANSFORM_3D
	multimesh.mesh = shape
	multimesh.instance_count = pads.size()
	for k in pads.size():
		var pad: Array = pads[k]
		multimesh.set_instance_transform(k, Transform3D(Basis(Vector3.UP, pad[2]).scaled(Vector3.ONE * pad[3]), Vector3(pad[0], level + 0.005, pad[1])))
	_pads = MultiMeshInstance3D.new()
	_pads.name = "Lily pads"
	_pads.multimesh = multimesh
	var material := ShaderMaterial.new()
	material.shader = load("res://shaders/lily_pads.gdshader")
	material.set_shader_parameter("height_map", height_texture)
	material.set_shader_parameter("rect_min", Vector2(bounds.minX, bounds.minZ))
	material.set_shader_parameter("rect_size", Vector2(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ))
	material.set_shader_parameter("texel", Vector2(1.0 / columns, 1.0 / rows))
	_pads.material_override = material
	_pads.extra_cull_margin = 2.0
	add_child(_pads)


func _make_drops() -> void:
	for array in [_drop_p, _drop_v]:
		array.resize(DROPS)
	_drop_age.resize(DROPS)
	_drop_alive.resize(DROPS)
	_drops = MeshInstance3D.new()
	_drops.name = "Water drops"
	_drops.mesh = ArrayMesh.new()
	_drops.extra_cull_margin = 16384.0
	_drops.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var material := ShaderMaterial.new()
	material.shader = load("res://shaders/water_drops.gdshader")
	_drops.material_override = material
	add_child(_drops)


## Where (x, z) falls on the grid, or -1 off it (and on its edge).
func _index(x: float, z: float) -> int:
	var i := floori((x - bounds.minX) / cell)
	var j := floori((z - bounds.minZ) / cell)
	return -1 if i < 1 or j < 1 or i >= columns - 1 or j >= rows - 1 else j * columns + i


## How deep the water is at (x, z): 0 dry → 1.
func depth(x: float, z: float) -> float:
	var k := _index(x, z)
	return 0.0 if k < 0 else mask[k]


func _push(kind: int, x: float, z: float, radius: float, a: Vector4 = Vector4.ZERO, b: Vector4 = Vector4.ZERO) -> void:
	if _pushes.size() >= MAX_PUSHES:
		return
	_pushes.append([Vector4(kind, x, z, radius), a, b])


## Pushes the surface down (or up) round (x, z): it springs back as rings.
func disturb(x: float, z: float, radius: float = 0.25, amount: float = 0.04) -> void:
	_push(0, x, z, maxf(1.0, roundf(radius / cell)) * cell, Vector4(amount, 0, 0, 0))


func _throw_drop(at: Vector3, velocity: Vector3) -> void:
	var k := _next_drop
	_next_drop = (_next_drop + 1) % DROPS
	_drop_alive[k] = 1
	_drop_age[k] = 0.0
	_drop_p[k] = at
	_drop_v[k] = velocity


## A splash: the water pushed down, drops thrown up and out (along `along`, if given).
func splash(at: Vector3, strength: float = 1.0, along: Vector3 = Vector3.ZERO) -> bool:
	if depth(at.x, at.z) <= 0.02:
		return false
	disturb(at.x, at.z, 0.18 + 0.25 * strength, 0.05 + 0.08 * strength)
	var count := roundi(6.0 + 26.0 * strength)
	for n in count:
		var angle: float = random.call() * TAU
		var out: float = (0.4 + random.call() * 1.4) * (0.6 + strength * 0.6)
		var up: float = 1.2 + random.call() * 2.2 * (0.5 + strength * 0.7)
		var velocity := Vector3(cos(angle) * out, up, sin(angle) * out)
		if along != Vector3.ZERO:
			velocity += along * (0.8 * strength * random.call())
		_throw_drop(Vector3(at.x + cos(angle) * 0.08, level + 0.02, at.z + sin(angle) * 0.08), velocity)
	return true


## A wall of water driven across the cone before `at` along `direction`: out from him (a push, power > 0), or in towards him (a pull).
func shove(at: Vector3, direction: Vector3, range_: float = 5.8, cone: float = 0.95, power: float = 1.0) -> void:
	var dir := Vector2(direction.x, direction.z).normalized()
	_shoves.append({ "x": at.x, "z": at.z, "dir": dir, "range": range_, "cos": cos(cone), "power": power, "front": 0.3 if power > 0.0 else range_, "speed": 9.0 / 60.0 })


## An explosion opened the ground at `at`: in the water, a hole blown in it that the water rushes back into,
## meeting in a jet; on the bank, the stream pours into the crater where it touches the water. Returns
## "water", "flooded" or "".
func crater(at: Vector3, radius: float = 1.2) -> String:
	var r := ceili(radius / cell)
	var ci := floori((at.x - bounds.minX) / cell)
	var cj := floori((at.z - bounds.minZ) / cell)
	var inside := {}
	var wet := 0
	for j in range(cj - r, cj + r + 1):
		for i in range(ci - r, ci + r + 1):
			if i < 1 or j < 1 or i >= columns - 1 or j >= rows - 1:
				continue
			var d := Vector2(i - ci, j - cj).length() / r
			if d > 1.0:
				continue
			var k := j * columns + i
			inside[k] = d
			if mask[k] > 0.0:
				wet += 1
	if inside.is_empty():
		return ""
	# The crater's dry cells that the water reaches (touching it, or through other such cells) fill.
	var dry := {}
	for k: int in inside:
		if mask[k] <= 0.0 and inside[k] < 0.85:
			dry[k] = true
	var queue: Array = []
	for k: int in dry:
		if mask[k - 1] > 0.0 or mask[k + 1] > 0.0 or mask[k - columns] > 0.0 or mask[k + columns] > 0.0:
			queue.append(k)
	var flooded := {}
	for k in queue:
		flooded[k] = true
	while not queue.is_empty():
		var k: int = queue.pop_back()
		for n in [k - 1, k + 1, k - columns, k + columns]:
			if dry.has(n) and not flooded.has(n):
				flooded[n] = true
				queue.append(n)
	for k: int in flooded:
		var d: float = inside[k]
		mask[k] = maxf(0.25, 0.75 * (1.0 - d * d))
	if not flooded.is_empty():
		_mask_changed = true
	# Blown out: a hole in the water (and the new stretch empty, filling from its edge).
	_push(1, at.x, at.z, r * cell, Vector4(0.5, 0, 0, 0))
	if wet > inside.size() * 0.25:
		_rushes.append({ "at": at, "wait": 0.42, "strength": 1.3 })
		return "water"
	if not flooded.is_empty():
		_rushes.append({ "at": at, "wait": 0.6, "strength": 0.6 })
		return "flooded"
	return ""


func _advance_shoves() -> void:
	for s in range(_shoves.size() - 1, -1, -1):
		var shove: Dictionary = _shoves[s]
		var push: bool = shove.power > 0.0
		shove.front += shove.speed if push else -shove.speed
		if (shove.front > shove.range) if push else (shove.front < 0.4):
			_shoves.remove_at(s)
			continue
		var dir: Vector2 = shove.dir
		_push(2, shove.x, shove.z, shove.range, Vector4(dir.x, dir.y, shove.cos, shove.power), Vector4(shove.range, shove.front, 0, 0))
		# Spray off the crest as it is driven.
		var strength := absf(shove.power)
		for n in 3:
			var turn: float = (random.call() * 2.0 - 1.0) * acos(shove.cos)
			var aim := dir.rotated(turn)
			var x: float = shove.x + aim.x * shove.front
			var z: float = shove.z + aim.y * shove.front
			var near: float = 1.0 - shove.front / shove.range
			if depth(x, z) <= 0.0 or random.call() > 0.5 * near * (2.0 - near) * strength:
				continue
			var sign := 1.0 if push else -1.0
			var out: float = (1.5 + random.call() * 2.0) * near * sign
			_throw_drop(Vector3(x, level + 0.04, z), Vector3(aim.x * out, 1.0 + random.call() * 2.2 * near, aim.y * out))


func _update_drops(dt: float) -> void:
	var points := PackedVector3Array()
	var colours := PackedColorArray()
	for n in DROPS:
		if _drop_alive[n] == 0:
			continue
		_drop_age[n] += dt
		var v := _drop_v[n]
		v.y -= 9.8 * dt
		_drop_v[n] = v
		var p := _drop_p[n] + v * dt
		_drop_p[n] = p
		if p.y < level:
			_drop_alive[n] = 0
			# Back into the water: a little ring of its own.
			if random.call() < 0.35:
				disturb(p.x, p.z, 0.08, 0.012)
			continue
		points.append(p)
		colours.append(Color(0.78, 0.95, 1.0, minf(1.0, 1.4 - _drop_age[n])))
	var mesh: ArrayMesh = _drops.mesh
	mesh.clear_surfaces()
	if points.is_empty():
		return
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = points
	arrays[Mesh.ARRAY_COLOR] = colours
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_POINTS, arrays)


## Each frame: waders stir the water round their legs; the waves run (60 steps a second); the drops fly.
func update(dt: float, waders: Array = []) -> void:
	for wader in waders:
		if wader.speed < 0.2 or depth(wader.x, wader.z) <= 0.02:
			continue
		# Wading: the water is pushed ahead and closes behind, a wake.
		disturb(wader.x, wader.z, 0.22, minf(0.004, wader.speed * 0.0015) * dt * 60.0)
	_accumulator = minf(_accumulator + dt, 0.1)
	while _accumulator >= 1.0 / 60.0:
		_accumulator -= 1.0 / 60.0
		_advance_shoves()
		var data := PackedFloat32Array()
		for push: Array in _pushes:
			for vector: Vector4 in push:
				data.append_array([vector.x, vector.y, vector.z, vector.w])
		var count := _pushes.size()
		_pushes.clear()
		var new_mask := PackedByteArray()
		if _mask_changed:
			_mask_changed = false
			new_mask = mask.to_byte_array()
			_depth_image.set_data(columns, rows, false, Image.FORMAT_RF, new_mask)
			depth_texture.update(_depth_image)
		if _ready_gpu:
			RenderingServer.call_on_render_thread(_gpu_step.bind(data, count, new_mask))
	# The water closing over a blown hole meets in a jet.
	for n in range(_rushes.size() - 1, -1, -1):
		var rush: Dictionary = _rushes[n]
		rush.wait -= dt
		if rush.wait > 0.0:
			continue
		var at: Vector3 = rush.at
		splash(at, rush.strength)
		for m in roundi(14.0 * rush.strength):
			var x: float = (random.call() - 0.5) * 0.2
			var vx: float = (random.call() - 0.5) * 0.8
			var vy: float = 3.5 + random.call() * 2.5
			_throw_drop(Vector3(at.x + x, level + 0.05, at.z + (random.call() - 0.5) * 0.2), Vector3(vx, vy, (random.call() - 0.5) * 0.8))
		_rushes.remove_at(n)
	_update_drops(dt)


## The lights whose glints the ripples catch: [{ position, color (× intensity) }], the nearest first.
func set_glints(lights: Array) -> void:
	var positions := PackedVector3Array()
	var colours := PackedVector3Array()
	for i in GLINTS:
		if i < lights.size():
			positions.append(lights[i].position)
			var c: Color = lights[i].color
			colours.append(Vector3(c.r, c.g, c.b))
		else:
			positions.append(Vector3.ZERO)
			colours.append(Vector3.ZERO)
	_material.set_shader_parameter("glint_pos", positions)
	_material.set_shader_parameter("glint_color", colours)


## The stream as it was, for a restart (craters flooded it).
func reset() -> void:
	mask = _first_mask.duplicate()
	_mask_changed = true
	_shoves.clear()
	_rushes.clear()
	_pushes.clear()
	_drop_alive.fill(0)
	if _ready_gpu:
		var empty := PackedFloat32Array()
		empty.resize(columns * rows * 4)
		var bytes := empty.to_byte_array()
		RenderingServer.call_on_render_thread(func() -> void:
			_rd.texture_update(_state, 0, bytes)
			_rd.texture_update(_next, 0, bytes))
