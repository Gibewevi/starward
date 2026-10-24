class_name HeroAnimator
extends RefCounted
## Motion capture playback for the Jedi rig (port of src/animator.js).
## Captured idle, walk and run are blended by speed with a shared gait phase,
## so steps never restart when the pace changes. Light procedural layers sit
## on top: leaning into acceleration and turns, a sprint crouch, arms held
## clear of the coat, a head that looks into turns, the sword hand, and a
## ground pass that plants the soles.
##
## The clips, the stride widening and the gait cycle lengths come baked from
## the JavaScript (assets/data/mocap.json): tests/test_animator.gd replays a
## trace of it and must land on the same pose. The poses are worked out here,
## in the skeleton's space (the hero's own), then set on the Skeleton3D.
## (Still to port with the combat, step 2: the arm IK of sword strikes.)

const SOLES := [
	["LeftFoot", Vector3(0, -0.09, -0.035)], ["LeftFoot", Vector3(0, -0.09, 0.07)], ["LeftToeBase", Vector3(0, -0.025, 0.02)],
	["RightFoot", Vector3(0, -0.09, -0.035)], ["RightFoot", Vector3(0, -0.09, 0.07)], ["RightToeBase", Vector3(0, -0.025, 0.02)],
]
const IDLE_BLADE := Vector3(-0.52, -0.6, 0.6)
const WALK_BLADE := Vector3(-0.5, -0.75, -0.2)
const RUN_BLADE := Vector3(-0.3, -0.36, -0.88)

var skeleton: Skeleton3D
var socket: Node3D
var names: PackedStringArray
var index := {}            ## bone name → its place in the mocap order
var bone_ids := PackedInt32Array()  ## the skeleton's bone for each
var parents := PackedInt32Array()   ## parent, in the mocap order (-1: none)
var rest: Array[Vector3] = []
var clips := {}
var scale := 1.0
var cycle := {}
var state := { "phase": 0.0, "idle_time": 0.0, "motion": 0.0, "running": 0.0, "sprint": 0.0, "bank": 0.0, "lean": 0.0, "look": 0.0, "ground_offset": 0.0 }

## The pose worked out this frame: local rotations and positions, and the bones' transforms in the skeleton's space.
var rotations: Array[Quaternion] = []
var positions: Array[Vector3] = []
var globals: Array[Transform3D] = []


func _init(target: Skeleton3D, saber_socket: Node3D = null, data: Dictionary = {}) -> void:
	skeleton = target
	socket = saber_socket
	if data.is_empty():
		data = load_mocap()
	names = PackedStringArray(data.bones)
	for i in names.size():
		index[names[i]] = i
		bone_ids.append(skeleton.find_bone(names[i]) if skeleton else i)
		rest.append(_vector(data.rest[i]))
	for i in names.size():
		var parent := skeleton.get_bone_parent(bone_ids[i]) if skeleton else -1
		parents.append(names.find(skeleton.get_bone_name(parent)) if parent >= 0 else -1)
	scale = data.scale
	cycle = data.cycle
	for name in data.clips:
		var clip: Dictionary = data.clips[name]
		var frames: Array = []
		for frame in clip.rotations:
			var quaternions: Array[Quaternion] = []
			for k in names.size():
				quaternions.append(Quaternion(frame[k * 4], frame[k * 4 + 1], frame[k * 4 + 2], frame[k * 4 + 3]))
			frames.append(quaternions)
		var hips: Array[Vector3] = []
		for h in clip.hips:
			hips.append(_vector(h))
		clips[name] = { "fps": clip.fps, "frames": int(clip.frames), "rotations": frames, "hips": hips, "ground": PackedFloat32Array(clip.ground), "duration": clip.frames / clip.fps }
	rotations.resize(names.size())
	positions.resize(names.size())
	globals.resize(names.size())


static func load_mocap() -> Dictionary:
	var file := FileAccess.open("res://assets/data/mocap.json", FileAccess.READ)
	return JSON.parse_string(file.get_as_text()) if file else {}


static func _vector(values: Array) -> Vector3:
	return Vector3(values[0], values[1], values[2])


static func _damp(value: float, target: float, rate: float, dt: float) -> float:
	return lerpf(value, target, 1.0 - exp(-rate * dt))


static func _smooth(value: float) -> float:
	return value * value * (3.0 - 2.0 * value)


## A pose of the clip at `phase` (0 → 1 over its cycle).
func _sample(clip: Dictionary, phase: float) -> Dictionary:
	var count: int = clip.frames
	var position := fposmod(phase, 1.0) * count
	var i := int(floorf(position)) % count
	var j := (i + 1) % count
	var t := position - floorf(position)
	var a: Array = clip.rotations[i]
	var b: Array = clip.rotations[j]
	var q: Array[Quaternion] = []
	for k in names.size():
		q.append(_slerp(a[k], b[k], t))
	return { "q": q, "hips": (clip.hips[i] as Vector3).lerp(clip.hips[j], t), "ground": lerpf(clip.ground[i], clip.ground[j], t) }


func _blend(a: Dictionary, b: Dictionary, weight: float) -> Dictionary:
	if weight <= 0.0:
		return a
	if weight >= 1.0:
		return b
	var q: Array[Quaternion] = []
	for k in names.size():
		q.append(_slerp(a.q[k], b.q[k], weight))
	return { "q": q, "hips": (a.hips as Vector3).lerp(b.hips, weight), "ground": lerpf(a.ground, b.ground, weight) }


## As THREE.Quaternion.slerpFlat: the short way round, a plain blend when the two are all but the same.
static func _slerp(a: Quaternion, b: Quaternion, t: float) -> Quaternion:
	if t <= 0.0:
		return a
	if t >= 1.0:
		return b
	var cosine := a.dot(b)
	var direction := 1.0 if cosine >= 0.0 else -1.0
	var square_sine := 1.0 - cosine * cosine
	var s := 1.0 - t
	var u := t * direction
	if square_sine > 2.220446049250313e-16:
		var sine := sqrt(square_sine)
		var angle := atan2(sine, cosine * direction)
		s = sin(s * angle) / sine
		u = sin(t * angle) / sine * direction
	var result := Quaternion(a.x * s + b.x * u, a.y * s + b.y * u, a.z * s + b.z * u, a.w * s + b.w * u)
	if s == 1.0 - t:
		result = result.normalized()
	return result


## Turns a bone by Euler angles (XYZ, as three.js) in its parent's space: q ← offset · q.
func _pre(name: String, rx: float, ry: float, rz: float) -> void:
	var k: int = index[name]
	rotations[k] = Quaternion(Basis.from_euler(Vector3(rx, ry, rz), EULER_ORDER_XYZ)) * rotations[k]


func _globals() -> void:
	for k in names.size():
		var local := Transform3D(Basis(rotations[k]), positions[k])
		globals[k] = local if parents[k] < 0 else globals[parents[k]] * local


func _apply_pose(pose: Dictionary, layers: Dictionary, action: Dictionary = {}) -> float:
	for k in names.size():
		rotations[k] = pose.q[k]
		positions[k] = rest[k]
	var hips: int = index.Hips
	positions[hips] = rest[hips] + (pose.hips as Vector3) * scale
	var motion: float = layers.motion
	var running: float = layers.running
	var sprint: float = layers.sprint
	var bank: float = layers.bank
	var lean: float = layers.lean
	var look: float = layers.look
	# Torso: forward pitch into acceleration and sprint, roll into turns. The
	# neck and head take back most of it, so the gaze stays on the horizon.
	var pitch := lean + sprint * 0.24 * motion + running * 0.08
	_pre("Hips", pitch * 0.25, 0, bank * 0.35)
	_pre("Spine", pitch * 0.35, 0, bank * 0.4)
	_pre("Spine1", pitch * 0.3, look * 0.2, bank * 0.3)
	_pre("Spine2", pitch * 0.2, look * 0.2, 0)
	_pre("Neck", -pitch * 0.45, look * 0.25, -bank * 0.4)
	_pre("Head", -pitch * 0.35, look * 0.35, -bank * 0.4)
	# The tailored coat is bulkier than the captured performer: hold the arms
	# clear of it. At rest the hands hang out to the sides, ready, as drawn.
	var ready := 1.0 - motion
	_pre("LeftArm", 0, 0, 0.2 + ready * 0.16 - running * 0.06)
	_pre("RightArm", -0.1 * ready, 0, -(0.24 + ready * 0.18 - running * 0.05))
	_pre("LeftForeArm", 0, -0.38 * ready, 0)
	_pre("RightForeArm", 0, 0.45 * ready, 0)
	# A wider, grounded stance at rest.
	_pre("LeftUpLeg", 0, 0, 0.12 * ready)
	_pre("RightUpLeg", 0, 0, -0.12 * ready)
	_pre("LeftFoot", 0, 0, -0.12 * ready)
	_pre("RightFoot", 0, 0, 0.12 * ready)
	positions[hips].y -= sprint * motion * 0.035
	# Sword work: the torso twists and pitches into the strike, the gaze stays
	# on the target, and the knees bend into a fighting stance.
	var weight: float = action.get("weight", 0.0)
	if weight > 0.0:
		var yaw: float = action.yaw
		var strike: float = action.pitch
		_pre("Spine", strike * 0.35 * weight, yaw * 0.35 * weight, 0)
		_pre("Spine1", strike * 0.35 * weight, yaw * 0.35 * weight, 0)
		_pre("Spine2", strike * 0.3 * weight, yaw * 0.3 * weight, 0)
		_pre("Neck", -strike * 0.4 * weight, -yaw * 0.3 * weight, 0)
		_pre("Head", -strike * 0.4 * weight, -yaw * 0.3 * weight, 0)
		var bend: float = action.crouch * 0.42 * weight
		for side in ["Left", "Right"]:
			_pre(side + "UpLeg", -bend, 0, 0)
			_pre(side + "Leg", bend * 2.0, 0, 0)
			_pre(side + "Foot", -bend, 0, 0)
	# Ground pass: the lowest sole meets the floor, except during the run's captured flight phase.
	_globals()
	var lowest := INF
	for sole in SOLES:
		lowest = minf(lowest, (globals[index[sole[0]]] * (sole[1] as Vector3)).y)
	var correction: float = pose.ground * scale - lowest
	state.ground_offset = correction
	positions[hips].y += correction + action.get("lift", 0.0) * weight
	_globals()
	return correction


## options: dt, time, speed, run_blend, sprint_intent, turn_rate, forward_accel, action — as animator.update.
func update(options: Dictionary = {}) -> void:
	var dt := clampf(options.get("dt", 1.0 / 60.0), 0.0, 0.05)
	var time: float = options.get("time", 0.0)
	var speed: float = options.get("speed", 0.0)
	var run_blend: float = options.get("run_blend", 0.0)
	var sprint_intent: float = float(options.get("sprint_intent", run_blend))
	var turn_rate: float = options.get("turn_rate", 0.0)
	var forward_accel: float = options.get("forward_accel", 0.0)
	var action: Dictionary = options.get("action", {})
	state.motion = _damp(state.motion, _smooth(clampf(speed / 0.45, 0.0, 1.0)), 10.0 if speed > 0.1 else 7.0, dt)
	state.running = _damp(state.running, clampf(run_blend, 0.0, 1.0), 9.0, dt)
	state.sprint = _damp(state.sprint, clampf(sprint_intent, 0.0, 1.0), 18.0, dt)
	state.bank = _damp(state.bank, clampf(-turn_rate * speed * 0.016, -0.2, 0.2), 8.0, dt)
	state.lean = _damp(state.lean, clampf(forward_accel / 22.0, -1.0, 1.0) * 0.12, 10.0, dt)
	state.look = _damp(state.look, clampf(turn_rate * 0.05, -0.32, 0.32), 6.0, dt)
	# One phase drives both gaits. Its rate follows the real ground speed, so
	# the planted foot stays under the body; very slow steps keep a minimum pace.
	var distance := lerpf(cycle.walk, cycle.run, state.running)
	state.phase = fmod(state.phase + maxf(speed, 0.5 * state.motion) / distance * dt, 1.0)
	state.idle_time += dt
	var idle := _sample(clips.idle, state.idle_time / clips.idle.duration)
	var walk := _sample(clips.walk, state.phase)
	var run := _sample(clips.run, state.phase)
	var gait := _blend(walk, run, _smooth(state.running))
	var pose := _blend(idle, gait, state.motion)
	_apply_pose(pose, state, action)
	_aim_blade(time, action)
	if skeleton:
		for k in names.size():
			skeleton.set_bone_pose_rotation(bone_ids[k], rotations[k])
			skeleton.set_bone_pose_position(bone_ids[k], positions[k])


## The blade is carried low, then trails behind in a run; it follows the swing of the captured sword arm.
func _aim_blade(time: float, action: Dictionary) -> void:
	if socket == null:
		return
	var motion: float = state.motion
	var running: float = state.running
	var ready := 1.0 - motion
	var target := IDLE_BLADE.normalized().lerp(WALK_BLADE.normalized(), motion).lerp(RUN_BLADE.normalized(), _smooth(running) * motion)
	var hand: Transform3D = globals[index.RightHand]
	var reach: Vector3 = hand.origin - globals[index.RightArm].origin
	target.z += (reach.z - 0.02) * 1.2 * (1.0 - 0.8 * _smooth(running))
	target.y += sin(time * 1.3) * 0.02 * ready
	var direction := target.normalized()
	var weight: float = action.get("weight", 0.0)
	if weight > 0.0:
		direction = direction.lerp((action.blade as Vector3).normalized(), weight).normalized()
	# In the hand's frame (the socket's parent follows the hand bone): the hand's turn undone, then the blade's.
	var blade := Quaternion(Vector3.UP, direction)
	socket.quaternion = hand.basis.get_rotation_quaternion().inverse() * blade
