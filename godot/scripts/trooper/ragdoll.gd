class_name Ragdoll
extends RefCounted
## Verlet ragdoll (port of src/ragdoll.js). Every limb is a rigid triangle of
## particles; neighbouring limbs share the particle at their joint, which acts
## as a ball joint, and soft range constraints keep joints within plausible
## angles. Particles can be kinematic — placed by the animated pose every
## frame, keeping their velocity — or simulated. Severing a joint gives the
## child side its own copy of the shared particle, so a limb comes free with
## the velocity it had. Simulated particles fall, collide with the floor and
## with other limbs; a particle may carry its own floor bounce and friction (a
## light, hard piece clatters and skids where a body lies still). Obstacles on
## the floor (the level's boxes, `obstacles`) stop them too: a body thrown
## into a crate hits it, bounces off and slides down its side.
## A body drives its mesh from the frame of its three particles.
##
## The particles are kept in doubles, as the JavaScript's numbers, so the same
## throw lands in the same place (tests/test_ragdoll.gd replays one).

const STEP := 1.0 / 120.0
## Contact pushes up to this size (m) become velocity as usual, which keeps
## resting contacts calm; the excess of a deep overlap is removed without
## adding speed, so freshly cut, overlapping parts are not launched.
const SLIP := 0.002
## Pairs of particles further apart than this (m) cannot meet within the next
## few steps (GATHER): they are not tested meanwhile (see _gather()).
const MARGIN := 0.3
const GATHER := 3


## A rigid body: its particles (the first three define its frame), the mesh it drives.
class Body:
	var name := ""
	var indices := PackedInt32Array()
	var object: Node3D
	var offset := Transform3D.IDENTITY
	var dynamic := false
	var index := 0
	## The blade's capsule: particle names at its ends and its radius; and their slots in `indices`.
	var capsule: Array = []
	var capsule_slots := PackedInt32Array([0, 1])
	var last_hit := -INF
	## A plate knocked off: a loose piece, not a part of him.
	var debris := false


var gravity := -11.0
var damping := 0.996
var friction := 0.18
var bounce := 0.15

# Particles: positions and previous positions (doubles), and what each one is.
var px := PackedFloat64Array()
var py := PackedFloat64Array()
var pz := PackedFloat64Array()
var qx := PackedFloat64Array()
var qy := PackedFloat64Array()
var qz := PackedFloat64Array()
var radius := PackedFloat64Array()
var inverse_mass := PackedFloat64Array()
var kinematic := PackedByteArray()
## Its own floor friction and bounce (NAN: the ragdoll's).
var own_friction := PackedFloat64Array()
var own_bounce := PackedFloat64Array()
## Loose pieces ('ghosts') fall through animated bodies, onto the floor.
var ghost := PackedByteArray()
var placed_over := PackedFloat64Array()
var names := PackedStringArray()
## The bodies each particle belongs to (their indices).
var owners: Array[PackedInt32Array] = []

var bodies: Array[Body] = []
# Constraints: the pair, its range, the body it keeps rigid (-1: a joint range), its joint's tag.
var c_a := PackedInt32Array()
var c_b := PackedInt32Array()
var c_min := PackedFloat64Array()
var c_max := PackedFloat64Array()
var c_body := PackedInt32Array()
var c_tag := PackedStringArray()
var adjacent := {}
## Muscles: callables run every step after integration (an active ragdoll), given the step.
var drivers: Array[Callable] = []
## The level's obstacles (boxes on the floor), or null.
var obstacles: Obstacles
var accumulator := 0.0

# What _gather() found for this frame: particle pairs worth testing, near boxes.
var _pairs := PackedInt32Array()
var _related := PackedByteArray()
var _related_size := -1
var _near := PackedFloat64Array()


func count() -> int:
	return px.size()


func add_particle(position: Vector3, particle_radius: float = 0.05, mass: float = 1.0, particle_name: String = "") -> int:
	return add_particle_at(position.x, position.y, position.z, particle_radius, mass, particle_name)


## A particle where (x, y, z) is, in doubles.
func add_particle_at(x: float, y: float, z: float, particle_radius: float = 0.05, mass: float = 1.0, particle_name: String = "") -> int:
	px.append(x); py.append(y); pz.append(z)
	qx.append(x); qy.append(y); qz.append(z)
	radius.append(particle_radius)
	inverse_mass.append(1.0 / mass)
	kinematic.append(1)
	own_friction.append(NAN)
	own_bounce.append(NAN)
	ghost.append(0)
	placed_over.append(NAN)
	names.append(particle_name)
	owners.append(PackedInt32Array())
	_related_size = -1
	return px.size() - 1


func position(index: int) -> Vector3:
	return Vector3(px[index], py[index], pz[index])


func previous(index: int) -> Vector3:
	return Vector3(qx[index], qy[index], qz[index])


func set_position(index: int, at: Vector3) -> void:
	px[index] = at.x; py[index] = at.y; pz[index] = at.z


func set_previous(index: int, at: Vector3) -> void:
	qx[index] = at.x; qy[index] = at.y; qz[index] = at.z


func is_kinematic(index: int) -> bool:
	return kinematic[index] != 0


func set_kinematic(index: int, value: bool) -> void:
	kinematic[index] = 1 if value else 0


## A particle's own floor behaviour (NAN: the ragdoll's own).
func set_surface(index: int, surface_friction: float, surface_bounce: float) -> void:
	own_friction[index] = surface_friction
	own_bounce[index] = surface_bounce


func add_body(body_name: String, indices: PackedInt32Array, object: Node3D = null) -> Body:
	var body := Body.new()
	body.name = body_name
	body.indices = indices.duplicate()
	body.object = object
	body.index = bodies.size()
	bodies.append(body)
	for index in indices:
		owners[index].append(body.index)
	# Rigid: every pair of the body's particles keeps its distance.
	for i in indices.size():
		for j in range(i + 1, indices.size()):
			add_constraint(indices[i], indices[j], body.index)
	_related_size = -1
	return body


func add_constraint(a: int, b: int, body: int = -1, minimum: float = NAN, maximum: float = NAN, tag: String = "") -> void:
	var dx := px[b] - px[a]
	var dy := py[b] - py[a]
	var dz := pz[b] - pz[a]
	var length := sqrt(dx * dx + dy * dy + dz * dz)
	c_a.append(a)
	c_b.append(b)
	c_min.append(length if is_nan(minimum) else minimum)
	c_max.append(length if is_nan(maximum) else maximum)
	c_body.append(body)
	c_tag.append(tag)


## Joint range: the two particles stay between min and max apart.
func add_limit(a: int, b: int, minimum: float, maximum: float = INF, tag: String = "") -> void:
	add_constraint(a, b, -1, minimum, maximum, tag)


func connect_bodies(a: Body, b: Body) -> void:
	adjacent[a.index * 65536 + b.index] = true
	adjacent[b.index * 65536 + a.index] = true
	_related_size = -1


## The frame of a body's three particles.
func frame(body: Body) -> Transform3D:
	var p0 := position(body.indices[0])
	var x := (position(body.indices[1]) - p0).normalized()
	var z := (position(body.indices[2]) - p0).cross(x).normalized()
	var y := z.cross(x)
	return Transform3D(Basis(x, y, z), p0)


## Records how the body's mesh sits in its particle frame.
func bind(body: Body, object_world: Transform3D) -> void:
	body.offset = frame(body).affine_inverse() * object_world


func object_transform(body: Body) -> Transform3D:
	return frame(body) * body.offset


## Places a kinematic particle; its last position becomes the previous one.
func place(index: int, at: Vector3, dt: float) -> void:
	place_at(index, at.x, at.y, at.z, dt)


func place_at(index: int, x: float, y: float, z: float, dt: float) -> void:
	qx[index] = px[index]; qy[index] = py[index]; qz[index] = pz[index]
	px[index] = x; py[index] = y; pz[index] = z
	placed_over[index] = dt


func release(list: Array) -> void:
	for body: Body in list:
		body.dynamic = true
	for body: Body in list:
		for index in body.indices:
			if kinematic[index] == 0:
				continue
			var all_dynamic := true
			for owner in owners[index]:
				if not bodies[owner].dynamic:
					all_dynamic = false
					break
			if not all_dynamic:
				continue
			kinematic[index] = 0
			# The pose moved it over a whole frame; Verlet steps are shorter.
			var over := placed_over[index]
			var ratio := minf(1.0, (1.0 / 120.0) / over) if over > 0.0 else 0.0
			qx[index] = px[index] + (qx[index] - px[index]) * ratio
			qy[index] = py[index] + (qy[index] - py[index]) * ratio
			qz[index] = pz[index] + (qz[index] - pz[index]) * ratio


## Splits the joint particle so the given bodies get their own copy.
func sever(index: int, child_bodies: Array, tag: String = "") -> int:
	var copy := add_particle_at(px[index], py[index], pz[index], radius[index], 1.0, names[index])
	qx[copy] = qx[index]; qy[copy] = qy[index]; qz[copy] = qz[index]
	inverse_mass[copy] = inverse_mass[index]
	kinematic[copy] = kinematic[index]
	own_friction[copy] = own_friction[index]
	own_bounce[copy] = own_bounce[index]
	ghost[copy] = ghost[index]
	placed_over[copy] = placed_over[index]
	var children := {}
	for body: Body in child_bodies:
		children[body.index] = true
	for body: Body in child_bodies:
		var slot := body.indices.find(index)
		if slot < 0:
			continue
		for k in body.indices.size():
			if body.indices[k] == index:
				body.indices[k] = copy
		owners[copy].append(body.index)
	var kept := PackedInt32Array()
	for owner in owners[index]:
		if not children.has(owner):
			kept.append(owner)
	owners[index] = kept
	for k in c_a.size():
		if c_body[k] >= 0 and children.has(c_body[k]):
			if c_a[k] == index:
				c_a[k] = copy
			if c_b[k] == index:
				c_b[k] = copy
	if not tag.is_empty():
		var k := 0
		while k < c_a.size():
			if c_tag[k] == tag:
				c_a.remove_at(k); c_b.remove_at(k); c_min.remove_at(k); c_max.remove_at(k); c_body.remove_at(k); c_tag.remove_at(k)
			else:
				k += 1
	# The two sides stay 'adjacent': their overlapping joint ends must not
	# shove each other apart the instant they are cut.
	_related_size = -1
	return copy


## Adds a velocity (m/s) to the given particles.
func push(indices: PackedInt32Array, velocity: Vector3, step: float = 1.0 / 120.0) -> void:
	push_xyz(indices, velocity.x, velocity.y, velocity.z, step)


func push_xyz(indices: PackedInt32Array, vx: float, vy: float, vz: float, step: float = 1.0 / 120.0) -> void:
	for index in indices:
		if kinematic[index] == 0:
			qx[index] -= vx * step
			qy[index] -= vy * step
			qz[index] -= vz * step


func velocity(index: int, step: float = 1.0 / 120.0) -> Vector3:
	return Vector3((px[index] - qx[index]) / step, (py[index] - qy[index]) / step, (pz[index] - qz[index]) / step)


## Its speed (m/s), in doubles.
func speed(index: int, step: float = 1.0 / 120.0) -> float:
	var dx := px[index] - qx[index]
	var dy := py[index] - qy[index]
	var dz := pz[index] - qz[index]
	return sqrt(dx * dx + dy * dy + dz * dz) / step


## Fixed 1/120 s steps from an accumulator. Variable steps would read the
## position corrections of a slowed-down frame (a hit stop) as huge speeds.
func step(dt: float) -> void:
	accumulator = minf(accumulator + maxf(0.0, dt), 0.1)
	if accumulator < STEP:
		return
	var moving := false
	for k in kinematic.size():
		if kinematic[k] == 0:
			moving = true
			break
	var steps := 0
	while accumulator >= STEP:
		if moving:
			if steps % GATHER == 0:
				_gather()
			substep(STEP)
		else:
			# Nothing simulated: only the muscles' own clocks run on.
			for driver in drivers:
				driver.call(STEP)
		accumulator -= STEP
		steps += 1


func substep(h: float) -> void:
	var n := px.size()
	for i in n:
		if kinematic[i] != 0:
			continue
		var vx := (px[i] - qx[i]) * damping
		var vy := (py[i] - qy[i]) * damping
		var vz := (pz[i] - qz[i]) * damping
		qx[i] = px[i]; qy[i] = py[i]; qz[i] = pz[i]
		px[i] += vx
		py[i] += vy + gravity * h * h
		pz[i] += vz
	for driver in drivers:
		driver.call(h)
	_find_near_boxes()
	for iteration in 10:
		_solve_all()
		_collide_floor()
		if not _near.is_empty() and iteration % 2 == 1:
			_collide_boxes()
		if iteration % 3 == 2:
			_collide_bodies()


## The pairs and boxes worth testing over this frame's steps: no two
## particles further apart than MARGIN (beyond their radii) can meet within a
## frame, so they are left out — the others are tested in the same order as
## all of them would be, and the result is the same.
func _gather() -> void:
	var n := px.size()
	if _related_size != n:
		_build_related()
	_pairs.clear()
	for i in n:
		var ki := kinematic[i]
		var gi := ghost[i]
		var xi := px[i]
		var yi := py[i]
		var zi := pz[i]
		var ri := radius[i] + MARGIN
		for j in range(i + 1, n):
			var kj := kinematic[j]
			if ki != 0 and kj != 0:
				continue
			if (ki != 0 and ghost[j] != 0) or (kj != 0 and gi != 0):
				continue
			var reach := ri + radius[j]
			var dx := px[j] - xi
			if dx > reach or dx < -reach:
				continue
			var dy := py[j] - yi
			if dy > reach or dy < -reach:
				continue
			var dz := pz[j] - zi
			if dz > reach or dz < -reach:
				continue
			if dx * dx + dy * dy + dz * dz >= reach * reach:
				continue
			if _related[i * n + j] != 0:
				continue
			_pairs.append(i)
			_pairs.append(j)


func _build_related() -> void:
	var n := px.size()
	_related_size = n
	_related.resize(n * n)
	_related.fill(0)
	for i in n:
		for j in range(i + 1, n):
			if _related_pair(i, j):
				_related[i * n + j] = 1
				_related[j * n + i] = 1


func _related_pair(a: int, b: int) -> bool:
	for body_a in owners[a]:
		for body_b in owners[b]:
			if body_a == body_b or adjacent.has(body_a * 65536 + body_b):
				return true
	return false


## The boxes the simulated particles might touch this step.
func _find_near_boxes() -> void:
	_near.clear()
	if obstacles == null or obstacles.bounds.is_empty():
		return
	var min_x := INF
	var min_z := INF
	var max_x := -INF
	var max_z := -INF
	var any := false
	for i in px.size():
		if kinematic[i] != 0:
			continue
		any = true
		min_x = minf(min_x, px[i]); max_x = maxf(max_x, px[i])
		min_z = minf(min_z, pz[i]); max_z = maxf(max_z, pz[i])
	if not any:
		return
	var b := obstacles.bounds
	for k in range(0, b.size(), 6):
		if b[k] > max_x + 0.5 or b[k + 3] < min_x - 0.5 or b[k + 2] > max_z + 0.5 or b[k + 5] < min_z - 0.5:
			continue
		for m in 6:
			_near.append(b[k + m])


func _collide_boxes() -> void:
	for i in px.size():
		if kinematic[i] != 0:
			continue
		var r := radius[i]
		for k in range(0, _near.size(), 6):
			var lo_x := _near[k]
			var lo_y := _near[k + 1]
			var lo_z := _near[k + 2]
			var hi_x := _near[k + 3]
			var hi_y := _near[k + 4]
			var hi_z := _near[k + 5]
			var x := px[i]
			var y := py[i]
			var z := pz[i]
			# Outside the box grown by its radius: it cannot touch it (the same as below, cheaper).
			if x <= lo_x - r or x >= hi_x + r or z <= lo_z - r or z >= hi_z + r or y <= lo_y - r or y >= hi_y + r:
				continue
			var cx := maxf(lo_x, minf(x, hi_x))
			var cy := maxf(lo_y, minf(y, hi_y))
			var cz := maxf(lo_z, minf(z, hi_z))
			var nx := x - cx
			var ny := y - cy
			var nz := z - cz
			var distance := sqrt(nx * nx + ny * ny + nz * nz)
			var depth := 0.0
			if distance >= r:
				continue
			if distance > 1e-6:
				nx /= distance; ny /= distance; nz /= distance
				depth = r - distance
			else:
				# The centre went in: out through the nearest face.
				var faces := [[lo_x - x, -1.0, 0.0, 0.0], [hi_x - x, 1.0, 0.0, 0.0], [hi_y - y, 0.0, 1.0, 0.0], [lo_z - z, 0.0, 0.0, -1.0], [hi_z - z, 0.0, 0.0, 1.0]]
				var best: Array = faces[0]
				for face: Array in faces:
					if absf(face[0]) < absf(best[0]):
						best = face
				nx = best[1]; ny = best[2]; nz = best[3]
				depth = absf(best[0]) + r
			px[i] += nx * depth; py[i] += ny * depth; pz[i] += nz * depth
			# Bounce off the face, rub along it.
			var vx := px[i] - qx[i]
			var vy := py[i] - qy[i]
			var vz := pz[i] - qz[i]
			var into := vx * nx + vy * ny + vz * nz
			if into >= 0.0:
				continue
			var own := own_friction[i]
			var rub := friction if is_nan(own) else own
			var spring := own_bounce[i]
			var give := (bounce if is_nan(spring) else spring) * (1.4 if into < -0.004 else 0.0)
			var tx := vx - into * nx
			var ty := vy - into * ny
			var tz := vz - into * nz
			var keep := 1.0 - rub * 0.6
			qx[i] = px[i] - (tx * keep - into * give * nx)
			qy[i] = py[i] - (ty * keep - into * give * ny)
			qz[i] = pz[i] - (tz * keep - into * give * nz)


func _solve_all() -> void:
	for k in c_a.size():
		var a := c_a[k]
		var b := c_b[k]
		var wa := 0.0 if kinematic[a] != 0 else inverse_mass[a]
		var wb := 0.0 if kinematic[b] != 0 else inverse_mass[b]
		if wa + wb == 0.0:
			continue
		var dx := px[b] - px[a]
		var dy := py[b] - py[a]
		var dz := pz[b] - pz[a]
		var distance := sqrt(dx * dx + dy * dy + dz * dz)
		if distance < 1e-6:
			continue
		var low := c_min[k]
		var high := c_max[k]
		var target := low if distance < low else (high if distance > high else distance)
		if target == distance:
			continue
		var f := (distance - target) / distance / (wa + wb)
		px[a] += dx * f * wa; py[a] += dy * f * wa; pz[a] += dz * f * wa
		px[b] -= dx * f * wb; py[b] -= dy * f * wb; pz[b] -= dz * f * wb


func _collide_floor() -> void:
	for i in px.size():
		if kinematic[i] != 0 or py[i] >= radius[i]:
			continue
		py[i] = radius[i]
		# Contact friction and a little bounce.
		var own := own_friction[i]
		var rub := friction if is_nan(own) else own
		var spring := own_bounce[i]
		var give := bounce if is_nan(spring) else spring
		qx[i] = px[i] - (px[i] - qx[i]) * (1.0 - rub)
		qz[i] = pz[i] - (pz[i] - qz[i]) * (1.0 - rub)
		# Only a particle moving into the floor bounces, and only from a real
		# impact (over ~0.5 m/s): slow contacts settle instead of jittering.
		# One already rising keeps its speed.
		var incoming := qy[i] - py[i]
		if incoming > 0.0:
			qy[i] = py[i] - incoming * give if incoming > 0.004 else py[i]


func _collide_bodies() -> void:
	var pairs := _pairs
	for k in range(0, pairs.size(), 2):
		var i := pairs[k]
		var j := pairs[k + 1]
		var ki := kinematic[i] != 0
		var kj := kinematic[j] != 0
		if ki and kj:
			continue
		var reach := radius[i] + radius[j]
		var dx := px[j] - px[i]
		var dy := py[j] - py[i]
		var dz := pz[j] - pz[i]
		var squared := dx * dx + dy * dy + dz * dz
		if squared >= reach * reach or squared < 1e-10:
			continue
		var distance := sqrt(squared)
		var wa := 0.0 if ki else inverse_mass[i]
		var wb := 0.0 if kj else inverse_mass[j]
		var f := (distance - reach) / distance / (wa + wb) * 0.5
		var scale := f * wa
		var pushed := absf(scale) * distance
		var still := 1.0 - SLIP / pushed if pushed > SLIP else 0.0
		px[i] += dx * scale; py[i] += dy * scale; pz[i] += dz * scale
		qx[i] += dx * scale * still; qy[i] += dy * scale * still; qz[i] += dz * scale * still
		scale = -f * wb
		pushed = absf(scale) * distance
		still = 1.0 - SLIP / pushed if pushed > SLIP else 0.0
		px[j] += dx * scale; py[j] += dy * scale; pz[j] += dz * scale
		qx[j] += dx * scale * still; qy[j] += dy * scale * still; qz[j] += dz * scale * still
