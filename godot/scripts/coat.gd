class_name Coat
extends MeshInstance3D
## The long coat skirt, simulated in the world (port of src/coat.js). The
## cloth wraps round the back and sides from the belt to mid-calf and stays
## open at the front, like the reference robe. Its waist row follows the
## captured pelvis; the legs push the front panels, air and inertia make the
## tails trail behind a run, and a soft memory of the tailored shape keeps the
## A-line silhouette without stiffness. Verlet particles, distance
## constraints, fixed 1/120 s steps.
## begin(dt, time, velocity) after the hero's pose; the mesh follows at the end of the frame.

const ROWS := 12
const COLUMNS := 27
const COUNT := ROWS * COLUMNS
const TOP := 0.80
const HEM := 0.24
const HIPS_HEIGHT := 0.765
const STEP := 1.0 / 120.0
const LEGS := [
	["LeftUpLeg", "LeftLeg", 0.1], ["LeftLeg", "LeftFoot", 0.08], ["LeftFoot", "LeftToeBase", 0.07],
	["RightUpLeg", "RightLeg", 0.1], ["RightLeg", "RightFoot", 0.08], ["RightFoot", "RightToeBase", 0.07],
]

## Whose pose it follows: the animator's bones (in the skeleton's space) and the skeleton (to the world).
var animator: HeroAnimator
var body: Skeleton3D
var root: Node3D

var positions := PackedVector3Array()
var previous := PackedVector3Array()
var targets := PackedVector3Array()
var last_targets := PackedVector3Array()
var goal := PackedVector3Array()
var local := PackedVector3Array()
var colors := PackedColorArray()
var memory := PackedFloat32Array()
var facing := PackedFloat32Array()
var indices := PackedInt32Array()
## The constraints: the two particles, the rest length, and how much of the
## correction each takes (stiffness shared by the free ends — the waist row is pinned).
var c_i := PackedInt32Array()
var c_j := PackedInt32Array()
var c_length := PackedFloat32Array()
var c_wi := PackedFloat32Array()
var c_wj := PackedFloat32Array()

var hips_frame := Transform3D.IDENTITY
var inverse_hips := Transform3D.IDENTITY
var segment_a := PackedVector3Array()
var segment_along := PackedVector3Array()
var segment_reach := PackedFloat32Array()  ## 1 / |along|²
var segment_low := PackedFloat32Array()    ## the heights a particle must be between to touch it
var segment_high := PackedFloat32Array()
var root_position := Vector3.ZERO
var last_root := Vector3.ZERO
var accumulator := 0.0
var _array_mesh := ArrayMesh.new()
var _task := -1


func _init(hero_animator: HeroAnimator = null, hero_skeleton: Skeleton3D = null, hero_root: Node3D = null) -> void:
	animator = hero_animator
	body = hero_skeleton
	root = hero_root
	_tailor()


## Tailored rest shape in the pelvis frame: an A-line wrap open at the front.
func _tailor() -> void:
	var base := Color("5a3b2e").srgb_to_linear()
	var fold := Color("432c23").srgb_to_linear()
	var hem := Color("6a4a3c").srgb_to_linear()
	positions.resize(COUNT)
	local.resize(COUNT)
	colors.resize(COUNT)
	memory.resize(ROWS)
	facing.resize(COLUMNS)
	for row in ROWS:
		var t := float(row) / (ROWS - 1)
		var flare := pow(t, 0.85)
		var gap := lerpf(0.12, 0.3, smoothstep(0.0, 1.0, t))
		var rx := lerpf(0.167, 0.32, flare)
		var rz := lerpf(0.123, 0.24, flare)
		# Spring towards the tailored shape (1/s²): firm at the belt, loose at the hem.
		memory[row] = 0.0 if row == 0 else 60.0 + 1500.0 * pow(1.0 - t, 2.4)
		for column in COLUMNS:
			var u := float(column) / (COLUMNS - 1)
			# Interfaced front edges keep the opening, as on a tailored robe.
			facing[column] = 1.0 + 2.5 * maxf(0.0, 1.0 - minf(u, 1.0 - u) * 9.0)
			var angle := gap + u * (PI * 2.0 - gap * 2.0)
			var i := row * COLUMNS + column
			var front := cos(angle)
			# Front panels hang straighter over the thighs than the flared back.
			var x := sin(angle) * rx * (1.0 - 0.12 * maxf(0.0, front) * t)
			var z := 0.004 + front * rz * (1.0 - 0.25 * maxf(0.0, front) * t)
			var y := TOP + (HEM - TOP) * t + (sin(u * 23.0) * 0.008 + front * 0.01 if row == ROWS - 1 else 0.0)
			local[i] = Vector3(x, y - HIPS_HEIGHT, z)
			var pleat := cos(angle * 9.0 + 0.4)
			var color := base.lerp(fold, maxf(0.0, pleat) * 0.35 * smoothstep(0.1, 0.6, t))
			colors[i] = color.lerp(hem, smoothstep(0.86, 1.0, t) * 0.45)
			if row < ROWS - 1 and column < COLUMNS - 1:
				var b := i + 1
				var c := i + COLUMNS
				var d := c + 1
				# three.js winds (a, c, b), (b, c, d) counter-clockwise; Godot's front faces are clockwise.
				indices.append_array([i, b, c, b, d, c])
	for array in [segment_a, segment_along]:
		array.resize(LEGS.size())
	for array in [segment_reach, segment_low, segment_high]:
		array.resize(LEGS.size())


func _ready() -> void:
	top_level = true
	# Last in the frame: the cloth's thread runs while everything else is processed.
	process_priority = 100
	mesh = _array_mesh
	cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	extra_cull_margin = 16384.0
	var material := ShaderMaterial.new()
	material.shader = load("res://shaders/coat.gdshader")
	material_override = material
	reset()


func _bone(name: String) -> Transform3D:
	return body.global_transform * animator.globals[animator.index[name]]


func _read_frame() -> void:
	hips_frame = _bone("Hips")
	inverse_hips = hips_frame.affine_inverse()
	targets.resize(COUNT)
	for i in COUNT:
		targets[i] = hips_frame * local[i]
	for s in LEGS.size():
		var from := _bone(LEGS[s][0]).origin
		var to := _bone(LEGS[s][1]).origin
		var radius: float = LEGS[s][2]
		segment_a[s] = from
		segment_along[s] = to - from
		segment_reach[s] = 1.0 / maxf(1e-8, (to - from).length_squared())
		segment_low[s] = minf(from.y, to.y) - radius
		segment_high[s] = maxf(from.y, to.y) + radius
	root_position = root.global_position


func _connect(i: int, j: int, stiffness: float) -> void:
	var wi := 0.0 if i < COLUMNS else 1.0
	var wj := 0.0 if j < COLUMNS else 1.0
	if wi + wj == 0.0:
		return
	c_i.append(i)
	c_j.append(j)
	c_length.append(targets[i].distance_to(targets[j]))
	c_wi.append(stiffness * wi / (wi + wj))
	c_wj.append(stiffness * wj / (wi + wj))


func reset() -> void:
	if animator == null:
		return
	if _task >= 0:
		WorkerThreadPool.wait_for_task_completion(_task)
		_task = -1
	_read_frame()
	positions = targets.duplicate()
	previous = targets.duplicate()
	last_targets = targets.duplicate()
	goal = targets.duplicate()
	last_root = root_position
	accumulator = 0.0
	c_i.clear(); c_j.clear(); c_length.clear(); c_wi.clear(); c_wj.clear()
	for row in ROWS:
		for column in COLUMNS:
			var p := row * COLUMNS + column
			if column + 1 < COLUMNS:
				_connect(p, p + 1, 1.0)
			if row + 1 < ROWS:
				_connect(p, p + COLUMNS, 1.0)
			if column + 1 < COLUMNS and row + 1 < ROWS:
				_connect(p, p + COLUMNS + 1, 0.5)
				_connect(p + 1, p + COLUMNS, 0.5)
			if column + 2 < COLUMNS:
				_connect(p, p + 2, 0.3)
			if row + 2 < ROWS:
				_connect(p, p + COLUMNS * 2, 0.35)
	_build()


## (Locals rather than members, and the weights worked out beforehand: GDScript is slow in tight loops.)
func _solve() -> void:
	var p := positions
	var ci := c_i
	var cj := c_j
	var rest := c_length
	var ki := c_wi
	var kj := c_wj
	for c in ci.size():
		var i := ci[c]
		var j := cj[c]
		var delta := p[j] - p[i]
		var distance := delta.length()
		if distance < 1e-6:
			continue
		var k := (distance - rest[c]) / distance
		p[i] += delta * (k * ki[c])
		p[j] -= delta * (k * kj[c])
	positions = p


func _collide() -> void:
	var p := positions
	var before := previous
	var hips := hips_frame
	var inverse := inverse_hips
	var low := hips.origin.y - 0.25
	var high := hips.origin.y + 0.13
	var starts := segment_a
	var alongs := segment_along
	var reaches := segment_reach
	var lows := segment_low
	var highs := segment_high
	var legs := LEGS.size()
	for i in range(COLUMNS, COUNT):
		var point := p[i]
		var moved := false
		# Pelvis: an elliptical column in the hips' frame.
		if point.y > low and point.y < high:
			var a := inverse * point
			if a.y < 0.08 and a.y > -0.2:
				var nx := a.x / 0.168
				var nz := (a.z - 0.004) / 0.124
				var r := sqrt(nx * nx + nz * nz)
				if r < 1.0 and r > 1e-5:
					point = hips * Vector3(nx / r * 0.168, a.y, 0.004 + nz / r * 0.124)
					moved = true
		for s in legs:
			if point.y < lows[s] or point.y > highs[s]:
				continue
			var from := starts[s]
			var along := alongs[s]
			var closest := from + along * clampf((point - from).dot(along) * reaches[s], 0.0, 1.0)
			var away := point - closest
			var distance := away.length()
			var radius: float = LEGS[s][2]
			if distance < radius and distance > 1e-5:
				point = closest + away * (radius / distance)
				moved = true
		if point.y < 0.03:
			point.y = 0.03
			moved = true
		if moved:
			# Contacts carry the cloth along instead of injecting energy.
			before[i] += (point - p[i]) * 0.8
			p[i] = point
	positions = p
	previous = before


## All at once (the tests): the step, then the mesh.
func update(dt: float, time: float, velocity: Vector3) -> void:
	begin(dt, time, velocity)
	finish()


## After the hero's pose: the cloth's steps start on a worker thread (they
## cost a few milliseconds of GDScript); finish() — at the end of the frame,
## the coat processing last — waits for them and builds the mesh.
func begin(dt: float, time: float, velocity: Vector3) -> void:
	finish()
	if animator == null:
		return
	_read_frame()
	if not is_finite(dt) or dt > 0.2 or root_position.distance_squared_to(last_root) > 1.0:
		reset()
		return
	if dt <= 0.0:
		return
	dt = minf(dt, 0.05)
	# Fixed steps: a slowed-down frame (hit stop) must not turn the solver's
	# corrections into speeds once time runs normally again.
	accumulator = minf(accumulator + dt, 0.1)
	var steps := int(floorf(accumulator / STEP))
	accumulator -= steps * STEP
	if steps == 0:
		return
	_task = WorkerThreadPool.add_task(_simulate.bind(steps, time, velocity), true, "Coat")


func finish() -> void:
	if _task < 0:
		return
	WorkerThreadPool.wait_for_task_completion(_task)
	_task = -1
	_build()


func _process(_delta: float) -> void:
	finish()


func _exit_tree() -> void:
	if _task >= 0:
		WorkerThreadPool.wait_for_task_completion(_task)
		_task = -1


func _simulate(steps: int, time: float, velocity: Vector3) -> void:
	var speed := minf(7.0, Vector2(velocity.x, velocity.z).length())
	# Relative airflow pushes the tails back; it gusts slightly with the stride.
	var wind := Vector3(-velocity.x, 0, -velocity.z) * (1.4 + speed * 0.3)
	var gust := wind.normalized()
	# Tailoring gives way to the airflow of a sprint, so the tails can fly.
	var hold := 1.0 / (1.0 + 0.08 * speed * speed)
	var damping := exp(-2.4 * STEP)
	var gravity := Vector3(0, -5.9, 0)
	for step in steps:
		# The waist and the tailored shape move smoothly across sub-steps.
		var fraction := float(step + 1) / steps
		for i in COUNT:
			goal[i] = last_targets[i].lerp(targets[i], fraction)
		var p := positions
		var before := previous
		for i in range(COLUMNS, COUNT):
			var row := i / COLUMNS
			var t := float(row) / (ROWS - 1)
			var here := p[i]
			var spring := memory[row] * hold * facing[i % COLUMNS]
			var flutter := sin(time * (3.1 + speed * 0.5) + (i % COLUMNS) * 0.5 + t * 3.0) * speed * 0.6 * t
			var push := (wind + gust * flutter) * t
			var acceleration := Vector3(push.x, 0, push.z) + gravity + (goal[i] - here) * spring
			p[i] = here + (here - before[i]) * damping + acceleration * (STEP * STEP)
			before[i] = here
		for i in COLUMNS:
			p[i] = goal[i]
		positions = p
		previous = before
		for iteration in 5:
			_solve()
			_collide()
	last_targets = targets.duplicate()
	last_root = root_position


## The mesh from the particles, with smooth normals (each face's, weighted by its area, as three.js computes them).
func _build() -> void:
	var normals := PackedVector3Array()
	normals.resize(COUNT)
	for f in range(0, indices.size(), 3):
		var a := indices[f]
		var b := indices[f + 1]
		var c := indices[f + 2]
		# Clockwise in Godot: the outward normal is (c - a) × (b - a).
		var n := (positions[c] - positions[a]).cross(positions[b] - positions[a])
		normals[a] += n
		normals[b] += n
		normals[c] += n
	for i in COUNT:
		normals[i] = normals[i].normalized()
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = positions
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_COLOR] = colors
	arrays[Mesh.ARRAY_INDEX] = indices
	_array_mesh.clear_surfaces()
	_array_mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
