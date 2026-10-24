class_name TrooperGait
extends RefCounted
## Motion capture for the stormtroopers (port of src/trooper-gait.js). The
## Jedi's captured idle, walk and run (as captured: assets/data/trooper.json)
## are played on each trooper's own skeleton: walk and run share one gait
## phase whose rate follows his real ground speed (so the planted foot stays
## put), the gaits cross-fade with the pace, and a fast turn on the spot
## becomes a few steps rather than a skid. Walking backwards plays the walk in
## reverse. Each trooper starts at his own point of the cycles, so the squad
## never moves in step.
##
## Retargeting: both skeletons stand +Z forward with identity rest rotations,
## so the trunk and legs copy the captured rotations (the trooper's single
## spine joint takes the captured Spine→Spine2 chain, his neck takes Neck and
## Head). His arms rest hanging down where the capture's rest is a T-pose: a
## fixed quarter turn about Z maps one rest onto the other, so the captured
## swing and twist carry over and the elbows still bend forward.
##
## update(dt, speed, backward, turn_rate), then the joint rotations are in
## `rotations` (local, per trooper joint), the pelvis offset in `hips`, and
## the captured height of the soles above the floor in ground().

const BONES := ["Hips", "Spine", "Spine1", "Spine2", "Neck", "Head", "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand", "RightShoulder", "RightArm", "RightForeArm", "RightHand", "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase", "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase"]
const PARENT := {
	"Hips": "", "Spine": "Hips", "Spine1": "Spine", "Spine2": "Spine1", "Neck": "Spine2", "Head": "Neck",
	"LeftUpLeg": "Hips", "LeftLeg": "LeftUpLeg", "LeftFoot": "LeftLeg", "LeftToeBase": "LeftFoot",
	"RightUpLeg": "Hips", "RightLeg": "RightUpLeg", "RightFoot": "RightLeg", "RightToeBase": "RightFoot",
	"LeftShoulder": "Spine2", "LeftArm": "LeftShoulder", "LeftForeArm": "LeftArm", "LeftHand": "LeftForeArm",
	"RightShoulder": "Spine2", "RightArm": "RightShoulder", "RightForeArm": "RightArm", "RightHand": "RightForeArm",
}
## The trooper joints the gait drives.
const JOINTS := ["pelvis", "spine", "neck", "hipL", "kneeL", "ankleL", "hipR", "kneeR", "ankleR", "shoulderL", "elbowL", "wristL", "shoulderR", "elbowR", "wristR"]
## Trooper arm rest (hanging) → captured arm rest (T-pose).
static var ARM_REST := { "L": Quaternion(Vector3(0, 0, 1), PI / 2.0), "R": Quaternion(Vector3(0, 0, 1), -PI / 2.0) }

static var _clips := {}
static var _parents := PackedInt32Array()

var scale := 1.0
## Ground covered by a full cycle on his legs.
var cycle := { "walk": 0.0, "run": 0.0 }
var state := { "phase": 0.0, "idle_time": 0.0, "motion": 0.0, "running": 0.0, "direction": 1.0, "speed": 0.0 }
var rotations := {}
var hips := Vector3.ZERO
var _pose := {}
var _world: Array[Quaternion] = []
var _local: Array[Quaternion] = []


## The clips, as captured: shared by every trooper.
static func clips() -> Dictionary:
	if _clips.is_empty():
		var file := FileAccess.open("res://assets/data/trooper.json", FileAccess.READ)
		var data: Dictionary = JSON.parse_string(file.get_as_text()) if file else {}
		for name in data.get("clips", {}):
			var clip: Dictionary = data.clips[name]
			var frames: Array = []
			for frame in clip.rotations:
				var quaternions: Array[Quaternion] = []
				for k in BONES.size():
					quaternions.append(Quaternion(frame[k * 4], frame[k * 4 + 1], frame[k * 4 + 2], frame[k * 4 + 3]))
				frames.append(quaternions)
			var hip_list: Array[Vector3] = []
			for h in clip.hips:
				hip_list.append(Vector3(h[0], h[1], h[2]))
			_clips[name] = {
				"fps": clip.fps, "frames": int(clip.frames), "speed": clip.speed, "leg_length": clip.legLength,
				"duration": clip.frames / clip.fps, "rotations": frames, "hips": hip_list, "ground": PackedFloat64Array(clip.ground),
			}
		_parents.clear()
		for name in BONES:
			_parents.append(BONES.find(PARENT[name]) if PARENT[name] != "" else -1)
	return _clips


## leg_length: hip to ankle on his skeleton; offset: where in the cycles he starts.
func _init(leg_length: float = 0.71, offset: float = 0.5) -> void:
	var c := clips()
	scale = leg_length / c.walk.leg_length
	cycle.walk = c.walk.speed * c.walk.duration * scale
	cycle.run = c.run.speed * c.run.duration * scale
	state.phase = fmod(offset, 1.0)
	state.idle_time = fmod(offset * 7.31, 1.0) * c.idle.duration
	for name in JOINTS:
		rotations[name] = Quaternion.IDENTITY
	_world.resize(BONES.size())
	_local.resize(BONES.size())


static func _smooth(u: float) -> float:
	return u * u * (3.0 - 2.0 * u)


static func _damp(value: float, target: float, rate: float, dt: float) -> float:
	return value + (target - value) * (1.0 - exp(-rate * dt))


func _sample(clip: Dictionary, phase: float) -> Dictionary:
	var count: int = clip.frames
	var position := fposmod(phase, 1.0) * count
	var i := int(floorf(position)) % count
	var j := (i + 1) % count
	var t := position - floorf(position)
	var a: Array = clip.rotations[i]
	var b: Array = clip.rotations[j]
	var q: Array[Quaternion] = []
	for k in BONES.size():
		q.append(HeroAnimator._slerp(a[k], b[k], t))
	return { "q": q, "hips": (clip.hips[i] as Vector3).lerp(clip.hips[j], t), "ground": clip.ground[i] + (clip.ground[j] - clip.ground[i]) * t }


static func _blend(a: Dictionary, b: Dictionary, weight: float) -> Dictionary:
	if weight <= 0.0:
		return a
	if weight >= 1.0:
		return b
	var q: Array[Quaternion] = []
	for k in BONES.size():
		q.append(HeroAnimator._slerp(a.q[k], b.q[k], weight))
	return { "q": q, "hips": (a.hips as Vector3).lerp(b.hips, weight), "ground": a.ground + (b.ground - a.ground) * weight }


func update(dt: float, speed: float = 0.0, backward: bool = false, turn_rate: float = 0.0) -> TrooperGait:
	var c := clips()
	dt = clampf(dt, 0.0, 0.05)
	# Turning on the spot steps round; a stagger steps too.
	var pace := maxf(speed, minf(0.9, absf(turn_rate) * 0.32))
	state.speed = pace
	state.motion = _damp(state.motion, _smooth(clampf(pace / 0.5, 0.0, 1.0)), 9.0 if pace > 0.1 else 6.0, dt)
	state.running = _damp(state.running, _smooth(clampf((pace - 1.7) / 1.4, 0.0, 1.0)), 7.0, dt)
	state.direction = -1.0 if backward else 1.0
	var distance := lerpf(cycle.walk, cycle.run, state.running)
	state.phase = fmod(state.phase + state.direction * maxf(pace, 0.45 * state.motion) / distance * dt + 1.0, 1.0)
	state.idle_time += dt
	var idle := _sample(c.idle, state.idle_time / c.idle.duration)
	var walk := _sample(c.walk, state.phase)
	var run := _sample(c.run, state.phase)
	_pose = _blend(idle, _blend(walk, run, _smooth(state.running)), state.motion)
	# Captured rotations, relative to his root.
	for k in BONES.size():
		_local[k] = _pose.q[k]
		_world[k] = _world[_parents[k]] * _local[k] if _parents[k] >= 0 else _local[k]
	var hips_q := _world[0]
	var chest := _world[3]
	rotations.pelvis = hips_q
	rotations.spine = hips_q.inverse() * chest
	rotations.neck = chest.inverse() * _world[5]
	for side in [["L", "Left", 14, 7], ["R", "Right", 18, 11]]:
		var leg: int = side[2]
		var arm: int = side[3]
		var rest: Quaternion = ARM_REST[side[0]]
		rotations["hip" + side[0]] = _local[leg]
		rotations["knee" + side[0]] = _local[leg + 1]
		rotations["ankle" + side[0]] = _local[leg + 2]
		rotations["shoulder" + side[0]] = chest.inverse() * _world[arm] * rest
		rotations["elbow" + side[0]] = rest.inverse() * _local[arm + 1] * rest
		rotations["wrist" + side[0]] = rest.inverse() * _local[arm + 2] * rest
	hips = (_pose.hips as Vector3) * scale
	return self


## Turns the legs (pelvis) by `yaw` about the vertical and the trunk back, so the chest keeps its heading.
func twist(yaw: float) -> void:
	if absf(yaw) < 1e-4:
		return
	var pelvis: Quaternion = rotations.pelvis
	# The chest (pelvis · spine) stays as it was: spine' = pelvis⁻¹ · yaw⁻¹ · pelvis · spine.
	var q := Quaternion(Vector3.UP, -yaw)
	rotations.spine = (pelvis.inverse() * q * pelvis) * rotations.spine
	rotations.pelvis = Quaternion(Vector3.UP, yaw) * pelvis


## The captured height of the soles above the floor, on his legs.
func ground() -> float:
	return _pose.get("ground", 0.0) * scale
