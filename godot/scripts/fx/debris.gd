class_name Debris
extends Node3D
## Loose objects on the lab floor — small crates, metal plates, canisters,
## pipes, odd components — and the dark fragments an explosion throws out
## (port of src/debris.js). Each is a small rigid body (a box): it flies and
## spins, lands on a corner or an edge, bounces, tips over, slides and comes
## to rest; it knocks against the crates and can land on them. Feet kick the
## small ones about. All of them are drawn as instances: one MultiMesh a kind.
##
## blast(at) throws everything nearby, the closer the harder; fragments(at)
## adds burning chunks; kick(at, velocity) is a foot walking through.

const KINDS := {
	"crate": { "size": [0.26, 0.24, 0.26], "color": 0x2b3038, "mass": 2.4 },
	"plate": { "size": [0.3, 0.024, 0.2], "color": 0x474c55, "mass": 0.7 },
	"canister": { "size": [0.1, 0.24, 0.1], "color": 0x5a5f68, "mass": 0.9, "round": true },
	"pipe": { "size": [0.05, 0.05, 0.42], "color": 0x4b5059, "mass": 0.6, "round": true },
	"part": { "size": [0.12, 0.07, 0.1], "color": 0x3b4048, "mass": 0.5 },
	"chunk": { "size": [0.15, 0.12, 0.14], "color": 0x131519, "mass": 0.8 },
}
const STEP := 1.0 / 120.0
const GRAVITY := 9.8
const CORNERS := [
	Vector3(-1, -1, -1), Vector3(1, -1, -1), Vector3(-1, 1, -1), Vector3(1, 1, -1),
	Vector3(-1, -1, 1), Vector3(1, -1, 1), Vector3(-1, 1, 1), Vector3(1, 1, 1),
]
## Burning fragments glow for a moment as they fly.
const HOT := Color(1.8, 0.5, 0.08)

var obstacles: Obstacles
var random: Callable
var capacity := 70
var bodies: Array = []
var meshes := {}
var _accumulator := 0.0


func _init(level: Obstacles = null, draw: Callable = Callable(), count: int = 70) -> void:
	name = "Debris"
	obstacles = level
	random = draw if draw.is_valid() else func() -> float: return randf()
	capacity = count
	for kind_name: String in KINDS:
		var kind: Dictionary = KINDS[kind_name]
		var material := StandardMaterial3D.new()
		var chunk := kind_name == "chunk"
		# Fragments take their colour per instance: they cool from orange to black.
		material.albedo_color = Color.WHITE if chunk else Color.hex(kind.color << 8 | 0xff)
		material.vertex_color_use_as_albedo = chunk
		material.roughness = 0.84 if chunk else 0.55
		material.metallic = 0.12 if chunk else 0.5
		var multimesh := MultiMesh.new()
		multimesh.transform_format = MultiMesh.TRANSFORM_3D
		multimesh.use_colors = chunk
		multimesh.mesh = _shape(kind_name)
		multimesh.instance_count = capacity
		multimesh.visible_instance_count = 0
		var instance := MultiMeshInstance3D.new()
		instance.name = "Debris %s" % kind_name
		instance.multimesh = multimesh
		instance.material_override = material
		instance.extra_cull_margin = 64.0
		add_child(instance)
		meshes[kind_name] = { "multimesh": multimesh, "list": [] }


## The shape of a kind, a unit size (scaled by each body's size).
static func _shape(kind_name: String) -> Mesh:
	if kind_name == "chunk":
		return _chunk()
	if KINDS[kind_name].get("round", false):
		var cylinder := CylinderMesh.new()
		cylinder.top_radius = 0.5
		cylinder.bottom_radius = 0.5
		cylinder.height = 1.0
		cylinder.radial_segments = 8
		cylinder.rings = 0
		if kind_name != "pipe":
			return cylinder
		# A pipe lies along Z.
		var arrays := cylinder.get_mesh_arrays()
		var turn := Basis(Vector3.RIGHT, PI / 2.0)
		var vertices: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
		var normals: PackedVector3Array = arrays[Mesh.ARRAY_NORMAL]
		for k in vertices.size():
			vertices[k] = turn * vertices[k]
			normals[k] = turn * normals[k]
		arrays[Mesh.ARRAY_VERTEX] = vertices
		arrays[Mesh.ARRAY_NORMAL] = normals
		arrays[Mesh.ARRAY_TANGENT] = null
		var pipe := ArrayMesh.new()
		pipe.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
		return pipe
	var box := BoxMesh.new()
	box.size = Vector3.ONE
	return box


## A torn, angular silhouette instead of an identical little cube: an icosahedron, dented (always the same way).
static func _chunk() -> ArrayMesh:
	var t := (1.0 + sqrt(5.0)) / 2.0
	var corners := [
		Vector3(-1, t, 0), Vector3(1, t, 0), Vector3(-1, -t, 0), Vector3(1, -t, 0),
		Vector3(0, -1, t), Vector3(0, 1, t), Vector3(0, -1, -t), Vector3(0, 1, -t),
		Vector3(t, 0, -1), Vector3(t, 0, 1), Vector3(-t, 0, -1), Vector3(-t, 0, 1),
	]
	var faces := [
		[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
		[3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
	]
	var vertices := PackedVector3Array()
	var normals := PackedVector3Array()
	for face in faces:
		var points := []
		for index in face:
			var p: Vector3 = corners[index].normalized() * 0.59
			var dent := 0.78 + 0.22 * pow(sin(p.x * 13.1 + p.y * 8.7 + p.z * 17.3), 2.0)
			points.append(Vector3(p.x * dent, p.y * (0.82 + dent * 0.18), p.z * dent))
		# Godot's front faces wind clockwise: the three.js triangle reversed.
		var normal: Vector3 = (points[1] - points[0]).cross(points[2] - points[0]).normalized()
		for k in [0, 2, 1]:
			vertices.append(points[k])
			normals.append(normal)
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	arrays[Mesh.ARRAY_NORMAL] = normals
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return mesh


func add(kind_name: String, position: Vector3, options: Dictionary = {}) -> Dictionary:
	var kind: Dictionary = KINDS[kind_name]
	var entry: Dictionary = meshes[kind_name]
	if entry.list.size() >= capacity:
		# Recycle the oldest fragment of that kind.
		var old: Dictionary = entry.list.pop_front()
		bodies.erase(old)
	var half: Vector3 = Vector3(kind.size[0], kind.size[1], kind.size[2]) * (0.5 * (0.85 + random.call() * 0.3))
	var scale: Variant = options.get("scale")
	if scale != null:
		half *= scale
	var mass: float = maxf(0.06, kind.mass * scale.x * scale.y * scale.z) if scale != null else kind.mass
	var inertia: float = mass * (4.0 * half.length_squared()) / 18.0
	var velocity: Variant = options.get("velocity")
	var quaternion: Variant = options.get("quaternion")
	var body := {
		"name": kind_name, "half": half, "mass": mass, "inv_mass": 1.0 / mass, "inv_inertia": 1.0 / inertia,
		"position": position, "velocity": velocity if velocity != null else Vector3.ZERO, "angular": options.get("spin", Vector3.ZERO),
		"quaternion": quaternion if quaternion != null else Quaternion(Vector3.UP, random.call() * TAU),
		"sleeping": velocity == null, "still": 0.0, "age": 0.0, "life": options.get("life", INF),
		"heat": options.get("temperature", 1.0) if kind_name == "chunk" else 0.0, "radius": minf(half.x, minf(half.y, half.z)) * 1.1 + 0.02,
		"last_position": null, "last_quaternion": null,
	}
	bodies.append(body)
	entry.list.append(body)
	return body


## Small objects strewn about the lab, mostly by the crates, never on the hero's start.
func scatter(count: int = 46) -> void:
	var names := ["crate", "plate", "plate", "canister", "canister", "pipe", "part", "part", "part"]
	var boxes: Array = []
	if obstacles:
		boxes = obstacles.boxes.filter(func(box: Dictionary) -> bool: return box.min.y < 0.1 and box.kind != "wall" and box.kind != "rail")
	for i in count:
		var kind_name: String = names[floori(random.call() * names.size())]
		var at: Variant = null
		var attempt := 0
		while attempt < 20 and at == null:
			attempt += 1
			var near: Variant = boxes[floori(random.call() * boxes.size())] if not boxes.is_empty() and random.call() < 0.7 else null
			var point: Vector3
			if near != null:
				var x := lerpf(near.min.x - 0.6, near.max.x + 0.6, random.call())
				point = Vector3(x, 0, lerpf(near.min.z - 0.6, near.max.z + 0.6, random.call()))
			else:
				var x: float = (random.call() - 0.5) * 16.0 - 2.0
				point = Vector3(x, 0, (random.call() - 0.5) * 14.0 - 3.0)
			if point.length() < 1.6:
				continue
			if obstacles and point.distance_to(obstacles.push_out(point, 0.22)) > 1e-3:
				continue
			at = point
		if at == null:
			continue
		var body := add(kind_name, at)
		# Lying as it fell: a pipe or a canister may be on its side.
		if (kind_name == "canister" and random.call() < 0.4) or kind_name == "pipe":
			body.quaternion = body.quaternion * Quaternion(Vector3.RIGHT, 0.0 if kind_name == "pipe" else PI / 2.0)
		_settle(body)
	_render()


## Puts a body down on the floor, resting on its lowest corner.
func _settle(body: Dictionary) -> void:
	var lowest := INF
	for corner: Vector3 in CORNERS:
		lowest = minf(lowest, (body.quaternion * (corner * body.half)).y)
	body.position.y = -lowest + 0.001


## Everything near a blast is thrown: outwards and up, spinning, the closer the harder.
func blast(at: Vector3, radius: float = 5.5, strength: float = 1.0) -> void:
	for body in bodies:
		var offset: Vector3 = body.position - at
		var distance := offset.length()
		if distance > radius:
			continue
		var falloff := pow(1.0 - distance / radius, 1.5) * strength
		offset.y = maxf(offset.y, 0.0) + 0.25 + random.call() * 0.5
		offset = offset.normalized()
		body.velocity += offset * ((6.5 + random.call() * 4.5) * falloff / sqrt(body.mass))
		var x: float = random.call() - 0.5
		var y: float = random.call() - 0.5
		body.angular += Vector3(x, y, random.call() - 0.5).normalized() * ((14.0 + random.call() * 16.0) * falloff)
		body.sleeping = false
		body.still = 0.0


## Dark torn fragments fly mostly outwards, with a few short rising arcs.
func fragments(at: Vector3, count: int = 14) -> void:
	var lobe_count := maxi(3, mini(6, roundi(count / 4.0)))
	var orientation: float = random.call() * TAU
	# Jittered sectors keep the impulse broad, including the near side of the
	# camera, without the perfectly equal spokes of a firework.
	var lobes: Array = []
	for index in lobe_count:
		var theta: float = orientation + float(index) / lobe_count * TAU + (random.call() - 0.5) * 0.35
		lobes.append({ "theta": theta, "rise": 0.12 + pow(random.call(), 1.4) * 0.28 })
	for i in count:
		var lobe: Dictionary = lobes[i % lobes.size()]
		var theta: float = lobe.theta + (random.call() - 0.5) * 0.45
		var rise: float = maxf(0.08, lobe.rise + (random.call() - 0.5) * 0.12)
		var large := i % 7 == 0
		var extent: float = 1.65 + random.call() * 0.65 if large else 0.45 + pow(random.call(), 1.5) * 0.85
		var speed: float = (3.8 if large else 4.4) + pow(random.call(), 1.2) * (3.5 if large else 5.5)
		var velocity := Vector3(cos(theta) * (1.0 - rise * 0.6), rise, sin(theta) * (1.0 - rise * 0.6)).normalized() * speed
		var sx: float = random.call() - 0.5
		var sy: float = random.call() - 0.5
		var spin := Vector3(sx, sy, random.call() - 0.5) * 30.0
		var kind_name := "part" if i % 4 == 3 else "chunk"
		var ox: float = (random.call() - 0.5) * 0.4
		var oy: float = 0.22 + random.call() * 0.23
		var where := at + Vector3(ox, oy, (random.call() - 0.5) * 0.4)
		var life: float = 12.0 + random.call() * 6.0
		var kx: float = extent * (0.7 + random.call() * 0.6)
		var ky: float = extent * (0.6 + random.call() * 0.7)
		var size := Vector3(kx, ky, extent * (0.8 + random.call() * 0.5))
		var temperature: float = 0.65 + random.call() * 0.25 if random.call() < 0.22 else 0.04 + random.call() * 0.2
		var ex: float = random.call() * 6.0
		var ey: float = random.call() * 6.0
		var turn := Stormtrooper._euler(ex, ey, random.call() * 6.0)
		add(kind_name, where, { "velocity": velocity, "spin": spin, "life": life, "scale": size, "temperature": temperature, "quaternion": turn })


## A foot (or a body) going through at `at` with `velocity` nudges what lies there.
func kick(at: Vector3, velocity: Vector3, radius: float = 0.32) -> void:
	var speed := Vector2(velocity.x, velocity.z).length()
	if speed < 0.6:
		return
	for body in bodies:
		if body.mass > 1.5 or body.position.y > 0.4:
			continue
		var dx: float = body.position.x - at.x
		var dz: float = body.position.z - at.z
		var distance := Vector2(dx, dz).length()
		if distance > radius + body.radius:
			continue
		body.velocity.x += (velocity.x * 0.8 + dx / maxf(distance, 0.05) * 0.6) / body.mass
		body.velocity.z += (velocity.z * 0.8 + dz / maxf(distance, 0.05) * 0.6) / body.mass
		body.velocity.y += 0.8 + speed * 0.2
		var x: float = random.call() - 0.5
		var y: float = random.call() - 0.5
		body.angular += Vector3(x, y, random.call() - 0.5) * 8.0
		body.sleeping = false
		body.still = 0.0


func _substep(body: Dictionary, h: float) -> void:
	var velocity: Vector3 = body.velocity
	var angular: Vector3 = body.angular
	var position: Vector3 = body.position
	velocity.y -= GRAVITY * h
	velocity *= exp(-0.08 * h)
	angular *= exp(-0.4 * h)
	position += velocity * h
	var angle := angular.length() * h
	if angle > 1e-7:
		body.quaternion = (Quaternion(angular.normalized(), angle) * body.quaternion).normalized()
	# The floor, at the box's corners: lands on an edge, tips over, slides.
	var contacts: Array[Vector3] = []
	var deepest := 0.0
	for corner: Vector3 in CORNERS:
		var point: Vector3 = body.quaternion * (corner * body.half) + position
		if point.y < 0.0:
			contacts.append(point)
			deepest = maxf(deepest, -point.y)
	if not contacts.is_empty():
		position.y += deepest
		# Scraping along the floor wastes energy.
		velocity.x *= exp(-1.6 * h)
		velocity.z *= exp(-1.6 * h)
		angular *= exp(-2.5 * h)
		for point in contacts:
			point.y += deepest
			var r := point - position
			var vc := angular.cross(r) + velocity
			var vn := vc.y
			if vn >= 0.0:
				continue
			var rn := r.cross(Vector3.UP)
			var k: float = body.inv_mass + body.inv_inertia * rn.length_squared()
			var bounce := 0.32 if vn < -1.4 else 0.0
			var j := -(1.0 + bounce) * vn / k / contacts.size()
			velocity.y += j * body.inv_mass
			angular += rn * (j * body.inv_inertia)
			# Friction against the floor, at most proportional to the push.
			vc.y = 0.0
			var slip := vc.length()
			if slip > 1e-5:
				var tangent := vc / slip
				var rt := r.cross(tangent)
				var kt: float = body.inv_mass + body.inv_inertia * rt.length_squared()
				var jt := minf(slip / kt / contacts.size(), 0.8 * j)
				velocity -= tangent * (jt * body.inv_mass)
				angular -= rt * (jt * body.inv_inertia)
		# Lying on two corners or more, it does not sink.
		if contacts.size() >= 2 and velocity.y < 0.0:
			velocity.y = 0.0
	# Crates and barriers: it hits their faces and can land on top.
	if obstacles:
		var radius: float = body.radius
		for box in obstacles.boxes:
			var low: Vector3 = box.min
			var high: Vector3 = box.max
			var n := position - Vector3(clampf(position.x, low.x, high.x), clampf(position.y, low.y, high.y), clampf(position.z, low.z, high.z))
			var distance := n.length()
			if distance >= radius:
				continue
			n = Vector3.UP if distance < 1e-6 else n / distance
			position += n * (radius - distance)
			var into := velocity.dot(n)
			if into < 0.0:
				velocity += n * (-into * 1.3)
				var tangent := velocity - n * velocity.dot(n)
				velocity -= tangent * 0.25
				angular *= 0.85
	body.velocity = velocity
	body.angular = angular
	body.position = position


func update(dt: float) -> void:
	_accumulator = minf(_accumulator + maxf(0.0, dt), 0.1)
	for body in bodies:
		if body.sleeping:
			continue
		if body.last_position == null:
			body.last_position = body.position
		if body.last_quaternion == null:
			body.last_quaternion = body.quaternion
	while _accumulator >= STEP:
		for body in bodies:
			if not body.sleeping:
				_substep(body, STEP)
		_accumulator -= STEP
	# Asleep once it has hardly moved for half a second (resting contacts jitter a little).
	if dt > 0.0:
		for body in bodies:
			if body.sleeping:
				continue
			var moved: float = body.position.distance_to(body.last_position) / dt
			var turned: float = body.quaternion.angle_to(body.last_quaternion) / dt
			body.still = body.still + dt if moved < 0.06 and turned < 0.25 and body.position.y < 0.6 else 0.0
			body.last_position = body.position
			body.last_quaternion = body.quaternion
			if body.still > 0.5:
				body.sleeping = true
				body.velocity = Vector3.ZERO
				body.angular = Vector3.ZERO
				body.last_position = null
				body.last_quaternion = null
	for body in bodies:
		body.age += dt
		if body.heat > 0.0:
			body.heat = maxf(0.0, body.heat - dt * 0.5)
	# Spent fragments sink away.
	for i in range(bodies.size() - 1, -1, -1):
		var body: Dictionary = bodies[i]
		if body.age < body.life + 1.0:
			continue
		bodies.remove_at(i)
		meshes[body.name].list.erase(body)
	_render()


func _render() -> void:
	var cold := Color.hex(KINDS.chunk.color << 8 | 0xff).srgb_to_linear()
	for kind_name: String in meshes:
		var entry: Dictionary = meshes[kind_name]
		var multimesh: MultiMesh = entry.multimesh
		var list: Array = entry.list
		for index in list.size():
			var body: Dictionary = list[index]
			var fade: float = 1.0 - smoothstep(body.life, body.life + 1.0, body.age) if is_finite(body.life) else 1.0
			multimesh.set_instance_transform(index, Transform3D(Basis(body.quaternion) * Basis.from_scale(body.half * (2.0 * fade)), body.position))
			if kind_name == "chunk":
				multimesh.set_instance_color(index, cold.lerp(HOT, body.heat * body.heat))
		multimesh.visible_instance_count = list.size()


func clear() -> void:
	bodies.clear()
	_accumulator = 0.0
	for entry in meshes.values():
		entry.list.clear()
	_render()


## Bodies still moving.
func awake() -> int:
	return bodies.filter(func(body: Dictionary) -> bool: return not body.sleeping).size()
