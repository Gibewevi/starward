class_name HeroRagdoll
extends RefCounted
## The hero thrown off his feet by a blast (port of src/hero-ragdoll.js). A
## Verlet ragdoll is built on his joints where his animated pose has them,
## launched with the blast's push and a tumble; it flies, hits the floor and
## the crates, bounces, rolls and slides. He stays alive in it: his muscles
## tuck his knees and bring his arms in front of his head while he flies, and
## keep him curled as he slides. His skeleton is fitted to the ragdoll every
## frame (the skinned body, the coat and the lit saber simply follow). Once he
## lies still he gets up — onto one knee, then standing, eased — and the
## motion capture takes him back.
##
## knock(velocity) starts it; update(dt) returns null while he is down and
## { x, z, heading } the moment he is back on his feet.
##
## knock(velocity, { dead = true }): he is dead — no muscles, a limp body that
## falls where the hit throws it and never gets up (a blast still moves it).
## `hit` ({ at, velocity }): the part nearest `at` takes a push of its own (a
## bolt through the shoulder twists him round as he goes down). `twitch` (s):
## a dead body's nerves still jerk its limbs, weaker and rarer as they pass.
##
## The pose is worked out in the animator's own arrays (the hero's space) and
## set on the skeleton, as the animator does.

const JOINTS := [
	["hips", "Hips", 0.13, 4.0], ["chest", "Spine2", 0.14, 4.0], ["neck", "Neck", 0.06, 1.0], ["head", "Head", 0.1, 1.5],
	["shoulderL", "LeftArm", 0.07, 1.2], ["elbowL", "LeftForeArm", 0.05, 0.8], ["handL", "LeftHand", 0.05, 0.5],
	["shoulderR", "RightArm", 0.07, 1.2], ["elbowR", "RightForeArm", 0.05, 0.8], ["handR", "RightHand", 0.05, 0.5],
	["hipL", "LeftUpLeg", 0.08, 2.0], ["kneeL", "LeftLeg", 0.065, 1.2], ["footL", "LeftFoot", 0.055, 0.8], ["toeL", "LeftToeBase", 0.04, 0.3],
	["hipR", "RightUpLeg", 0.08, 2.0], ["kneeR", "RightLeg", 0.065, 1.2], ["footR", "RightFoot", 0.055, 0.8], ["toeR", "RightToeBase", 0.04, 0.3],
]
const CROWN := Vector3(0, 0.2, 0.03)
const BODIES := [
	["torso", ["hips", "chest", "shoulderL", "shoulderR", "hipL", "hipR"]], ["neck", ["chest", "neck"]], ["head", ["neck", "head", "crown"]],
	["upperArmL", ["shoulderL", "elbowL"]], ["forearmL", ["elbowL", "handL"]], ["upperArmR", ["shoulderR", "elbowR"]], ["forearmR", ["elbowR", "handR"]],
	["thighL", ["hipL", "kneeL"]], ["shinL", ["kneeL", "footL"]], ["footL", ["footL", "toeL"]],
	["thighR", ["hipR", "kneeR"]], ["shinR", ["kneeR", "footR"]], ["footR", ["footR", "toeR"]],
]
const LINKS := [["torso", "neck"], ["neck", "head"], ["torso", "upperArmL"], ["upperArmL", "forearmL"], ["torso", "upperArmR"], ["upperArmR", "forearmR"],
	["torso", "thighL"], ["thighL", "shinL"], ["shinL", "footL"], ["torso", "thighR"], ["thighR", "shinR"], ["shinR", "footR"]]
## Ranges that keep the joints anatomical: elbows and knees do not fold flat, the head stays on.
const LIMITS := [["shoulderL", "handL", 0.14], ["shoulderR", "handR", 0.14], ["hipL", "footL", 0.26], ["hipR", "footR", 0.26], ["crown", "chest", 0.27], ["head", "hips", 0.5], ["kneeL", "chest", 0.22], ["kneeR", "chest", 0.22]]
## What a dead body's nerves jerk.
const TWITCHING := ["handL", "handR", "elbowL", "elbowR", "shoulderL", "shoulderR", "kneeL", "kneeR", "footL", "footR", "chest"]
const AIMS := [["Neck", "Head", "head"], ["LeftArm", "LeftForeArm", "elbowL"], ["LeftForeArm", "LeftHand", "handL"], ["RightArm", "RightForeArm", "elbowR"], ["RightForeArm", "RightHand", "handR"],
	["LeftUpLeg", "LeftLeg", "kneeL"], ["LeftLeg", "LeftFoot", "footL"], ["LeftFoot", "LeftToeBase", "toeL"], ["RightUpLeg", "RightLeg", "kneeR"], ["RightLeg", "RightFoot", "footR"], ["RightFoot", "RightToeBase", "toeR"]]
## One knee down, the other up, leaning forward: halfway up from the floor.
const KNEEL := { "Hips": [0, 0, 0], "Spine": [0.22, 0, 0], "Spine1": [0.14, 0, 0], "Neck": [-0.22, 0, 0], "LeftUpLeg": [-1.45, 0, 0.08], "LeftLeg": [1.5, 0, 0], "LeftFoot": [-0.05, 0, 0], "RightUpLeg": [-0.12, 0, -0.06], "RightLeg": [2.15, 0, 0], "RightFoot": [0.65, 0, 0], "LeftArm": [-0.5, 0, 0.35], "LeftForeArm": [0, -0.6, 0] }
## Alive: knees tucked, forearms up before the face, chin in — held loosely (left, up, front of the torso).
const TARGETS := [
	["kneeL", "hips", Vector3(0.13, -0.12, 0.3)], ["kneeR", "hips", Vector3(-0.13, -0.12, 0.3)], ["footL", "hips", Vector3(0.15, -0.42, 0.05)], ["footR", "hips", Vector3(-0.15, -0.42, 0.05)],
	["handL", "chest", Vector3(0.16, 0.12, 0.3)], ["handR", "chest", Vector3(-0.16, 0.1, 0.32)], ["elbowL", "chest", Vector3(0.24, -0.04, 0.16)], ["elbowR", "chest", Vector3(-0.24, -0.04, 0.16)],
	["head", "chest", Vector3(0, 0.2, 0.08)],
]

var hero: Node3D
var animator: HeroAnimator
var obstacles: Obstacles
var random: Callable
var ragdoll: Ragdoll
var index := {}
var state: Variant = null
var effort := 0.0
var _left := Vector3.RIGHT
var _up := Vector3.UP
var _front := Vector3.BACK


func _init(body: Node3D, pose: HeroAnimator, level: Obstacles = null, draw: Callable = Callable()) -> void:
	hero = body
	animator = pose
	obstacles = level
	random = draw if draw.is_valid() else func() -> float: return randf()


func _p(joint: String) -> Vector3:
	return ragdoll.position(index[joint])


func _bone(name: String) -> int:
	return animator.index[name]


## Where a bone of the current pose is, in the world.
func _world(name: String, offset: Vector3 = Vector3.ZERO) -> Vector3:
	return hero.global_transform * (animator.globals[_bone(name)] * offset)


func _build() -> void:
	ragdoll = Ragdoll.new()
	ragdoll.gravity = -11.0
	ragdoll.damping = 0.995
	ragdoll.friction = 0.3
	ragdoll.bounce = 0.18
	index = {}
	for joint in JOINTS:
		index[joint[0]] = ragdoll.add_particle(_world(joint[1]), joint[2], joint[3], joint[0])
	index.crown = ragdoll.add_particle(_world("Head", CROWN), 0.1, 1.0, "crown")
	var bodies := {}
	for entry in BODIES:
		var indices := PackedInt32Array()
		for member in entry[1]:
			indices.append(index[member])
		bodies[entry[0]] = ragdoll.add_body(entry[0], indices)
	for link in LINKS:
		ragdoll.connect_bodies(bodies[link[0]], bodies[link[1]])
	for limit in LIMITS:
		ragdoll.add_limit(index[limit[0]], index[limit[1]], limit[2])
	for k in ragdoll.count():
		ragdoll.set_kinematic(k, false)
	ragdoll.obstacles = obstacles
	ragdoll.drivers.append(_muscles)


## The torso's frame from its particles: left, up, front.
func _frame() -> bool:
	_up = (_p("chest") - _p("hips")).normalized()
	_left = _p("shoulderL") - _p("shoulderR")
	_left = (_left - _up * _left.dot(_up)).normalized()
	_front = _left.cross(_up)
	return _left.is_finite() and _left.length_squared() > 0.5


func _muscles(_h: float) -> void:
	if state == null or state.dead or state.phase == "rising" or effort <= 0.0 or not _frame():
		return
	for target in TARGETS:
		var offset: Vector3 = target[2]
		var goal: Vector3 = _p(target[1]) + _left * offset.x + _up * offset.y + _front * offset.z
		var k: int = index[target[0]]
		ragdoll.set_position(k, ragdoll.position(k).lerp(goal, 0.035 * effort))


func knock(velocity: Vector3, options: Dictionary = {}) -> bool:
	var spin: float = options.get("spin", NAN)
	if is_nan(spin):
		spin = 4.0 + random.call() * 4.0
	var dead: bool = options.get("dead", false) or (state != null and state.dead)
	if state != null and state.phase == "rising":
		state = null
	if state == null:
		_build()
	var centre := Vector3.ZERO
	for k in ragdoll.count():
		centre += ragdoll.position(k)
	centre /= ragdoll.count()
	# Thrown, and tumbling about an axis across the push.
	var flat := Vector3(velocity.x, 0, velocity.z)
	flat = flat.normalized() if flat.length_squared() > 1e-6 else Vector3(1, 0, 0)
	var axis := Vector3.UP.cross(flat) * (spin * (1.0 if random.call() < 0.75 else -0.7))
	for k in ragdoll.count():
		ragdoll.push(PackedInt32Array([k]), (axis.cross(ragdoll.position(k) - centre) + velocity) * (0.93 + random.call() * 0.14))
	var hit: Variant = options.get("hit")
	if hit != null:
		var nearest := 0
		for k in ragdoll.count():
			if ragdoll.position(k).distance_squared_to(hit.at) < ragdoll.position(nearest).distance_squared_to(hit.at):
				nearest = k
		ragdoll.push(PackedInt32Array([nearest]), hit.velocity)
	var twitch: float = options.get("twitch", 0.0)
	state = { "phase": "flying", "age": 0.0, "still": 0.0, "dead": dead, "twitch": twitch, "twitch_total": twitch, "next_twitch": 0.0 }
	effort = 0.0 if dead else 1.0
	return true


## The skeleton laid over the ragdoll.
func _fit() -> void:
	if not _frame():
		return
	var hips := _p("hips")
	hero.position = Vector3(hips.x, 0, hips.z)
	hero.rotation = Vector3.ZERO
	var k_hips := _bone("Hips")
	animator.positions[k_hips] = Vector3(0, hips.y, 0)
	animator.rotations[k_hips] = Basis(_left, _up, _front).get_rotation_quaternion()
	for name in ["Spine", "Spine1", "Spine2", "LeftShoulder", "RightShoulder"]:
		animator.rotations[_bone(name)] = Quaternion.IDENTITY
	animator._globals()
	var origin := hero.position
	for aim in AIMS:
		var k := _bone(aim[0])
		animator._aim_bone(k, animator.globals[k].origin, animator.globals[_bone(aim[1])].origin, _p(aim[2]) - origin)
	var head := _bone("Head")
	animator._aim_bone(head, animator.globals[head].origin, animator.globals[head] * CROWN, _p("crown") - origin)
	animator.apply()


func _snapshot() -> Array:
	return [animator.rotations.duplicate(), animator.positions.duplicate()]


func _restore(pose: Array) -> void:
	for k in animator.names.size():
		animator.rotations[k] = pose[0][k]
		animator.positions[k] = pose[1][k]


## From lying still to getting up: facing his feet if he lies on his back, his head if face down.
func _begin_rise(time: float) -> void:
	_frame()
	var on_back := _front.y > 0.0
	var direction := _p("hips") - _p("chest") if on_back else _p("chest") - _p("hips")
	var heading := atan2(direction.x, direction.z)
	# The hips, re-expressed in the turned body.
	var k_hips := _bone("Hips")
	var turn := Quaternion(Vector3.UP, heading)
	hero.rotation = Vector3(0, heading, 0)
	animator.rotations[k_hips] = turn.inverse() * animator.rotations[k_hips]
	animator.positions[k_hips] = turn.inverse() * animator.positions[k_hips]
	var lying := _snapshot()
	# Standing: what the motion capture would show right now. Kneeling: from it.
	animator.update({ "dt": 0.0, "time": time, "speed": 0.0, "run_blend": 0.0, "turn_rate": 0.0 })
	var standing := _snapshot()
	var kneeling := [standing[0].duplicate(), standing[1].duplicate()]
	for name: String in KNEEL:
		var bend: Array = KNEEL[name]
		var k := _bone(name)
		kneeling[0][k] = kneeling[0][k] * Stormtrooper._euler(bend[0], bend[1], bend[2])
	kneeling[1][k_hips] = kneeling[1][k_hips] + Vector3(0, -0.36, -0.05)
	_restore(lying)
	animator._globals()
	animator.apply()
	state = { "phase": "rising", "age": 0.0, "duration": 1.1 + random.call() * 0.25, "lying": lying, "kneeling": kneeling, "standing": standing, "heading": heading, "dead": false }


func _rise_step(dt: float) -> bool:
	state.age += dt
	var p := minf(1.0, state.age / state.duration)
	var a: Array = state.lying if p < 0.45 else state.kneeling
	var b: Array = state.kneeling if p < 0.45 else state.standing
	var u := Stormtrooper.ease_by("inOutCubic", p / 0.45 if p < 0.45 else (p - 0.45) / 0.55)
	for k in animator.names.size():
		animator.rotations[k] = HeroAnimator._slerp(a[0][k], b[0][k], u)
		animator.positions[k] = (a[1][k] as Vector3).lerp(b[1][k], u)
	animator._globals()
	animator.apply()
	return p >= 1.0


func update(dt: float, time: float = 0.0) -> Variant:
	if state == null or not (dt > 0.0):
		return null
	# Dead and lying still: nothing more to work out.
	if state.dead and state.still > 1.5 and not (state.twitch > 0.0):
		return null
	if state.phase == "rising":
		if not _rise_step(dt):
			return null
		var result := { "x": hero.position.x, "z": hero.position.z, "heading": state.heading }
		state = null
		ragdoll = null
		return result
	state.age += dt
	if state.twitch > 0.0:
		_twitch_step(dt)
	ragdoll.step(dt)
	# Flying he braces; down, he stays curled, his effort easing off.
	var airborne := _p("hips").y > 0.35
	if not state.dead:
		effort += ((1.0 if airborne else 0.18) - effort) * (1.0 - exp(-4.0 * dt))
	var fastest := 0.0
	for k in ragdoll.count():
		fastest = maxf(fastest, ragdoll.speed(k))
	state.still = state.still + dt if fastest < 0.5 else 0.0
	_fit()
	if not state.dead and ((state.age > 0.9 and state.still > 0.3) or state.age > 2.6):
		_begin_rise(time)
	return null


## A dead body's nerves: a limb jerks, then another — weaker and rarer as the seconds pass.
func _twitch_step(dt: float) -> void:
	state.twitch -= dt
	state.next_twitch -= dt
	if state.next_twitch > 0.0:
		return
	var strength := maxf(0.0, state.twitch / state.twitch_total)
	var joint: String = TWITCHING[floori(random.call() * TWITCHING.size())]
	var x: float = random.call() - 0.5
	var y: float = 0.3 + random.call() * 0.7
	var push: Vector3 = Vector3(x, y, random.call() - 0.5) * (2.6 * strength * (0.5 + random.call() * 0.5))
	ragdoll.push(PackedInt32Array([index[joint]]), push)
	state.next_twitch = (0.04 + random.call() * 0.22) / maxf(0.25, strength)


## Back on his feet at once (the hero is reset).
func stop() -> void:
	state = null
	ragdoll = null


func active() -> bool:
	return state != null


func dead() -> bool:
	return state != null and state.dead


## How long he has lain still (s).
func still() -> float:
	return state.still if state != null and state.has("still") else 0.0


func phase() -> String:
	return state.phase if state != null else ""


## Where his hips are (the camera follows them).
func position() -> Vector3:
	return _p("hips") if ragdoll != null and state.phase != "rising" else hero.position


func velocity() -> Vector3:
	return ragdoll.velocity(index.hips) if ragdoll != null and state.phase != "rising" else Vector3.ZERO
