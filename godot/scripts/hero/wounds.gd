class_name Wounds
extends Node3D
## Wounds on the hero (port of src/wounds.js): where a bolt went in (a charred
## black core in a ring of red), where a blast tore him (red spattered over
## the side that faced it). Each is a small cluster of specks stuck to the
## bone nearest the hit (a BoneAttachment3D), so it goes where he goes as he
## falls. Drawn like the red drops — round, unlit, red-black in the dark —
## they stay until the next try.
##
## strike(point, facing, kind): a wound on the part nearest `point`, on the
## side `facing` looks out of. riddle(facing, count): wounds over the side of
## him a blast came from. spill(at): once he lies still, a dark pool spreading
## out from under him over a few seconds (update(dt) grows it). clear() for
## the next try.

## The parts that take a wound, and how far their surface is from the bone.
const BODY := { "Hips": 0.14, "Spine1": 0.14, "Spine2": 0.15, "Neck": 0.06, "Head": 0.11, "LeftArm": 0.06, "LeftForeArm": 0.05, "RightArm": 0.06, "RightForeArm": 0.05, "LeftUpLeg": 0.08, "LeftLeg": 0.06, "RightUpLeg": 0.08, "RightLeg": 0.06 }

var hero: Node3D
var animator: HeroAnimator
var feel: Dictionary
var random: Callable
var wounds: Array[MeshInstance3D] = []
var pools: Array[MeshInstance3D] = []
var _attachments := {}
var _specks: ShaderMaterial
var _pool: ShaderMaterial


func _init(body: Node3D, pose: HeroAnimator, feel_data: Dictionary, draw: Callable = Callable()) -> void:
	name = "Wounds"
	hero = body
	animator = pose
	feel = feel_data
	random = draw if draw.is_valid() else func() -> float: return randf()
	_specks = ShaderMaterial.new()
	_specks.shader = load("res://shaders/wound_specks.gdshader")
	_pool = ShaderMaterial.new()
	_pool.shader = load("res://shaders/blood_pool.gdshader")
	StainLight.register(_specks, feel)
	StainLight.register(_pool, feel)


func _exit_tree() -> void:
	StainLight.forget(_specks)
	StainLight.forget(_pool)


## Where a bone is in the world now (its pose this frame).
func _bone_transform(bone: String) -> Transform3D:
	return animator.skeleton.global_transform * animator.globals[animator.index[bone]]


func _attachment(bone: String) -> BoneAttachment3D:
	if not _attachments.has(bone):
		var attachment := BoneAttachment3D.new()
		attachment.name = "Wounds on %s" % bone
		attachment.bone_name = bone
		animator.skeleton.add_child(attachment)
		_attachments[bone] = attachment
	return _attachments[bone]


## A cluster of specks on `bone` round `place` (world), spread across the surface `facing` looks out of.
func _add(bone: String, place: Vector3, facing: Vector3, kind: String) -> MeshInstance3D:
	var w: Dictionary = feel.death.wound[kind]
	var count := roundi(Feel.pick(w.specks))
	var side := Vector3.UP.cross(facing)
	if side.length_squared() < 1e-6:
		side = Vector3(1, 0, 0)
	side = side.normalized()
	var up := facing.cross(side).normalized()
	var to_bone := _bone_transform(bone).affine_inverse()
	var points := PackedVector3Array()
	var colours := PackedColorArray()
	var sizes := PackedVector2Array()
	for i in count:
		# The core first (charred, for a bolt), red round it; a little run downwards.
		var core := i < count * float(w.char)
		var reach: float = w.spread * (0.35 if core else 0.5 + random.call() * 0.8)
		var turn: float = random.call() * TAU
		var point := place + side * (cos(turn) * reach) + up * (sin(turn) * reach)
		if not core and random.call() < 0.3:
			point.y -= w.spread * random.call() * 1.5
		points.append(to_bone * point)
		var shade: float = 0.75 + random.call() * 0.35
		colours.append(Color(0.05, 0.018, 0.012, 1) if core else Color(0.58 * shade, 0.028 * shade, 0.02 * shade, 1))
		sizes.append(Vector2(Feel.pick(w.size) * (0.85 if core else 1.0), 0))
	var specks := MeshInstance3D.new()
	specks.name = "Wound (%s)" % kind
	var mesh := ArrayMesh.new()
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = points
	arrays[Mesh.ARRAY_COLOR] = colours
	arrays[Mesh.ARRAY_TEX_UV] = sizes
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_POINTS, arrays)
	specks.mesh = mesh
	specks.material_override = _specks
	specks.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	specks.extra_cull_margin = 4.0
	_attachment(bone).add_child(specks)
	wounds.append(specks)
	return specks


## On the part of him nearest `hit`, on its surface towards `facing`.
func strike(hit: Vector3, facing: Vector3, kind: String) -> MeshInstance3D:
	var best := ""
	var best_distance := INF
	for bone: String in BODY:
		var distance := _bone_transform(bone).origin.distance_to(hit)
		if distance < best_distance:
			best_distance = distance
			best = bone
	if best.is_empty():
		return null
	return _add(best, _bone_transform(best).origin + facing * float(BODY[best]), facing, kind)


## Torn by a blast: wounds here and there over the side of him that faced it.
func riddle(facing: Vector3, count: int) -> void:
	var names: Array = BODY.keys()
	for i in count:
		var bone: String = names[floori(random.call() * names.size())]
		var x: float = random.call() - 0.5
		var y: float = random.call() - 0.5
		var towards := (facing + Vector3(x, y, random.call() - 0.5) * 1.2).normalized()
		_add(bone, _bone_transform(bone).origin + towards * float(BODY[bone]), towards, "blast")


## Under him, where he lies still: the pool starts and spreads.
func spill(where: Vector3) -> MeshInstance3D:
	var pool_feel: Dictionary = feel.death.pool
	var sides := 28
	# Its edge: a few lobes, never a circle.
	var lobes := [random.call() * 6.0, random.call() * 6.0, random.call() * 6.0]
	var rim := PackedVector3Array()
	for i in sides:
		var turn := float(i) / sides * TAU
		var r: float = 1.0 + 0.16 * sin(turn * 2.0 + lobes[0]) + 0.1 * sin(turn * 3.0 + lobes[1]) + 0.07 * sin(turn * 5.0 + lobes[2])
		rim.append(Vector3(cos(turn) * r, 0, sin(turn) * r))
	var vertices := PackedVector3Array()
	var uvs := PackedVector2Array()
	for i in sides:
		for vertex in [[Vector3.ZERO, 0.0], [rim[i], 1.0], [rim[(i + 1) % sides], 1.0]]:
			vertices.append(vertex[0])
			uvs.append(Vector2(vertex[1], 0))
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	arrays[Mesh.ARRAY_TEX_UV] = uvs
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	var pool := MeshInstance3D.new()
	pool.name = "Pool"
	pool.mesh = mesh
	pool.material_override = _pool
	pool.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	pool.position = Vector3(where.x, 0.005, where.z)
	pool.rotation.y = random.call() * TAU
	pool.scale = Vector3.ONE * 1e-3
	pool.set_meta("pool", { "age": 0.0, "size": Feel.pick(pool_feel.size), "duration": Feel.pick(pool_feel.spread), "stretch": 0.75 + random.call() * 0.4 })
	add_child(pool)
	pools.append(pool)
	return pool


## Each frame: the pools spread, fast then slower and slower.
func update(dt: float) -> void:
	for pool in pools:
		var data: Dictionary = pool.get_meta("pool")
		data.age += dt
		var grown := 1.0 - pow(1.0 - minf(1.0, data.age / data.duration), 2.4)
		pool.scale = Vector3(data.size * grown, 1, data.size * grown * data.stretch)


func clear() -> void:
	for specks in wounds:
		specks.queue_free()
	wounds.clear()
	for pool in pools:
		pool.queue_free()
	pools.clear()


func count() -> int:
	return wounds.size()
