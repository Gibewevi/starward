class_name CombatController
extends RefCounted
## Lightsaber choreography (port of src/combat.js — same moves, same rules;
## tests/test_combat.gd replays a trace of the JavaScript and must land on the
## same poses). Each press of B plays a strike; strikes flow into each other
## through a graph — every move ends with the blade on one side (high right,
## left, or low in front) and the next is drawn at random among the moves that
## start there, never one used just before. B held through a strike calls the
## finisher. Where the next blow goes decides how it starts: ahead, an
## ordinary link; aside, a blow sweeping towards him; behind, a reverse thrust
## or a turning cut. Holding the guard raises a two-handed stance; parries,
## Force powers, the twirl and the draw flourish are moves too.
##
## The moves come baked (assets/data/combat.json): keyframes in the hero's
## space (+Z forward, -X the sword side) — the right hand, the blade's
## direction, the free hand, a two-handed grip, torso twist and pitch, a knee
## bend — joined with Catmull-Rom splines; twirls then spin the blade round an
## axis while the wrist circles.

const GUARD_SPEED := 2.2
const HOLD_LEFT := Vector3(0.12, 1.15, 0.48)


## A pose of the arms and body.
class Pose:
	var hand := Vector3.ZERO
	var blade := Vector3.UP
	var left := Vector3.ZERO
	var grip := 0.0
	var yaw := 0.0
	var pitch := 0.0
	var crouch := 0.0

	## A keyframe's pose; the stances have their blade normalised, the keys are splined as written.
	static func of(keyframe: Dictionary, unit: bool = true) -> Pose:
		var pose := Pose.new()
		pose.hand = Vector3(keyframe.hand[0], keyframe.hand[1], keyframe.hand[2])
		pose.blade = Vector3(keyframe.blade[0], keyframe.blade[1], keyframe.blade[2])
		if unit:
			pose.blade = pose.blade.normalized()
		pose.left = Vector3(keyframe.left[0], keyframe.left[1], keyframe.left[2])
		pose.grip = keyframe.grip
		pose.yaw = keyframe.yaw
		pose.pitch = keyframe.pitch
		pose.crouch = keyframe.crouch
		return pose

	func copy(other: Pose) -> Pose:
		hand = other.hand; blade = other.blade; left = other.left
		grip = other.grip; yaw = other.yaw; pitch = other.pitch; crouch = other.crouch
		return self

	## This pose ← a blended towards b.
	func mix(a: Pose, b: Pose, weight: float) -> Pose:
		hand = a.hand.lerp(b.hand, weight)
		blade = a.blade.lerp(b.blade, weight).normalized()
		left = a.left.lerp(b.left, weight)
		grip = lerpf(a.grip, b.grip, weight)
		yaw = lerpf(a.yaw, b.yaw, weight)
		pitch = lerpf(a.pitch, b.pitch, weight)
		crouch = lerpf(a.crouch, b.crouch, weight)
		return self


var moves := {}
var parries: Array = []
var feel := {}
## Draws a number in [0, 1) — randf, or a fixed list in the parity test.
var random: Callable
## What the hero's body takes from the sword work this frame (see update()).
var output := {
	"hand": Vector3.ZERO, "blade": Vector3.UP, "left": Vector3.ZERO, "grip": 0.0, "yaw": 0.0, "pitch": 0.0, "crouch": 0.0,
	"weight": 0.0, "guard": 0.0, "lift": 0.0, "spin": 0.0, "drive": 0.0, "input_scale": 1.0, "turn_scale": 1.0, "max_speed": INF,
	"trail": 0.0, "flare": 0.0, "shake": 0.0, "name": null, "engaged": false,
}
var guard_pose: Pose
var hold_pose: Pose
var force := 0.0
var action_pose := Pose.new()
var from_pose := Pose.new()
var last_pose := Pose.new()
var mixed := Pose.new()
var sway_pose := Pose.new()
var clock := 0.0
var history: Array[String] = []
## A new number for every combo, so effects can be limited per sequence.
var sequence := 0
var fired = null
var started = null
var last_parry = null
var cocked := false
var blend_from := false

var action = null  ## the move playing (its baked data, with its own tempo and variation), or null
var pinned := false
var time := 0.0
var hits := 0
var side = null
var queued := false
## B held through a strike: the finisher comes next.
var heavy := false
var charge := 0.0
## Where the next blow should go: { angle (rad, + to his left), distance } from the hero, or null.
var aim = null
## The blade turned towards the target ahead of the body (rad about the vertical).
var lead := 0.0
var recovery := 0.0
var guard := 0.0
var cooldown := 0.0
var impacted := false


func _init(draw: Callable = Callable(), data: Dictionary = {}, feel_data: Dictionary = {}) -> void:
	random = draw if draw.is_valid() else func() -> float: return randf()
	if data.is_empty():
		data = _load("res://assets/data/combat.json")
	feel = feel_data if not feel_data.is_empty() else _load("res://assets/data/feel.json")
	for name in data.moves:
		var move: Dictionary = data.moves[name].duplicate()
		var keys: Array = []
		for keyframe in move["keys"]:
			keys.append({ "t": float(keyframe.t), "pose": Pose.of(keyframe, false) })
		move["keys"] = keys
		moves[name] = move
	guard_pose = Pose.of(data.guard)
	hold_pose = Pose.of(data.hold)
	parries = data.parries
	reset()


static func _load(path: String) -> Dictionary:
	var file := FileAccess.open(path, FileAccess.READ)
	return JSON.parse_string(file.get_as_text()) if file else {}


static func _vector(values: Array) -> Vector3:
	return Vector3(values[0], values[1], values[2])


static func _ease(value: float) -> float:
	return value * value * (3.0 - 2.0 * value)


static func _in_window(t: float, window: Array, fade: float = 0.06) -> float:
	return clampf((t - window[0] + fade) / fade, 0.0, 1.0) * clampf((window[1] + fade - t) / fade, 0.0, 1.0)


static func _catmull(p0: float, p1: float, p2: float, p3: float, u: float) -> float:
	return 0.5 * (2.0 * p1 + (p2 - p0) * u + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * u * u + (3.0 * p1 - p0 - 3.0 * p2 + p3) * u * u * u)


static func _catmull3(a: Vector3, b: Vector3, c: Vector3, d: Vector3, u: float) -> Vector3:
	return Vector3(_catmull(a.x, b.x, c.x, d.x, u), _catmull(a.y, b.y, c.y, d.y, u), _catmull(a.z, b.z, c.z, d.z, u))


static func _smooth_range(a: float, b: float, value: float) -> float:
	return _ease(clampf((value - a) / (b - a), 0.0, 1.0))


func _choreography(name: String) -> float:
	return feel.choreography[name]


## Samples a move at normalised time t; twirls spin the blade around an axis.
static func sample_move(move: Dictionary, t: float, out: Pose, variation: float = 1.0) -> Pose:
	var keys: Array = move["keys"]
	var i := 0
	while i < keys.size() - 2 and t > keys[i + 1].t:
		i += 1
	var k0: Pose = keys[maxi(0, i - 1)].pose
	var k1: Pose = keys[i].pose
	var k2: Pose = keys[i + 1].pose
	var k3: Pose = keys[mini(keys.size() - 1, i + 2)].pose
	var u := clampf((t - keys[i].t) / (keys[i + 1].t - keys[i].t), 0.0, 1.0)
	out.hand = _catmull3(k0.hand, k1.hand, k2.hand, k3.hand, u)
	out.blade = _catmull3(k0.blade, k1.blade, k2.blade, k3.blade, u)
	out.left = _catmull3(k0.left, k1.left, k2.left, k3.left, u)
	out.grip = _catmull(k0.grip, k1.grip, k2.grip, k3.grip, u)
	out.yaw = _catmull(k0.yaw, k1.yaw, k2.yaw, k3.yaw, u) * variation
	out.pitch = _catmull(k0.pitch, k1.pitch, k2.pitch, k3.pitch, u)
	out.crouch = _catmull(k0.crouch, k1.crouch, k2.crouch, k3.crouch, u)
	out.blade = out.blade.normalized()
	for twirl in move.get("twirls", []):
		var progress := clampf((t - twirl[0]) / (twirl[1] - twirl[0]), 0.0, 1.0)
		if progress <= 0.0:
			continue
		var angle: float = _ease(progress) * twirl[2] * PI * 2.0
		var axis := _vector(twirl[3]).normalized()
		# While it turns, the blade lies in the circle's plane and the hand may
		# move to where the twirl is performed; both return for the next key.
		var hold := _smooth_range(0.0, 0.15, progress) * (1.0 - _smooth_range(0.85, 1.0, progress))
		if twirl.size() > 4 and twirl[4] != null:
			out.hand = out.hand.lerp(_vector(twirl[4]), hold)
		var flat := out.blade - axis * out.blade.dot(axis)
		if flat.length_squared() > 1e-6:
			out.blade = out.blade.lerp(flat.normalized(), hold).normalized()
		out.blade = out.blade.rotated(axis, angle)
		# The wrist drives the twirl: the hand circles slightly with the blade.
		var side_a := Vector3(axis.y, axis.z, axis.x).cross(axis).normalized()
		var side_b := axis.cross(side_a)
		var radius := 0.025 * sin(PI * progress)
		out.hand += side_a * (sin(angle) * radius) + side_b * ((1.0 - cos(angle)) * radius)
	return out


func reset() -> void:
	action = null
	pinned = false
	time = 0.0
	hits = 0
	side = null
	queued = false
	heavy = false
	charge = 0.0
	aim = null
	lead = 0.0
	recovery = 0.0
	guard = 0.0
	cooldown = 0.0
	started = null
	impacted = false
	output.weight = 0.0
	output.shake = 0.0
	output.flare = 0.0


func _has_role(move: Dictionary, role: String) -> bool:
	return (move.role as Array).has(role)


## A move is playing that is not a free flourish.
func busy() -> bool:
	return action != null and not action.get("free", false)


func guarding() -> bool:
	return guard > 0.5 and not busy()


## Name of the move that began since the last call, so the hero can re-aim.
func take_start() -> Variant:
	var name = started
	started = null
	return name


## The power whose moment came since the last call (it leaves the hand now).
func take_force() -> Variant:
	var name = fired
	fired = null
	return name


## Picks the next strike at random among those that start where the last
## ended: a quick opener, links, and the finisher once B has been held.
func choose(speed: float = 0.0) -> String:
	var fresh := hits == 0
	# Behind him (not a finisher): a blow that starts behind his back.
	if aim != null and absf(aim.angle) > _choreography("behind") and not heavy:
		return behind(aim)
	var role := ("run" if speed > 2.6 else "opener") if fresh else ("finisher" if heavy else "link")
	var of_role: Array = moves.keys().filter(func(name: String) -> bool: return _has_role(moves[name], role))
	var candidates: Array = of_role if fresh else of_role.filter(func(name: String) -> bool: return (moves[name].from as Array).has(side))
	if candidates.is_empty():
		candidates = of_role
	# To the side: a blow sweeping towards him, if there is one from where the blade is.
	if aim != null and absf(aim.angle) > _choreography("side") and role != "finisher":
		var towards := "L" if aim.angle > 0 else "R"
		var toward: Array = candidates.filter(func(name: String) -> bool: return moves[name].to == towards)
		if not toward.is_empty():
			candidates = toward
	var recent := history.slice(maxi(0, history.size() - int(feel.attacks.memory)))
	var unused: Array = candidates.filter(func(name: String) -> bool: return not recent.has(name))
	if not unused.is_empty():
		candidates = unused
	return candidates[mini(candidates.size() - 1, int(floorf(random.call() * candidates.size())))]


## The blow for an enemy behind: right behind and close, the reverse thrust;
## further, the turning cut — the short way round, or, him straight behind,
## the way the blade already is.
func behind(mark: Dictionary) -> String:
	var off := absf(absf(mark.angle) - PI)
	if mark.distance < _choreography("thrust") and off < _choreography("straight"):
		return "backThrust"
	if off < _choreography("either"):
		return "backSweepLeft" if side == "L" else "backSweepRight"
	return "backSweepLeft" if mark.angle > 0 else "backSweepRight"


## B pressed: a strike at once (out of the guard too: a riposte), or the next
## one queued. False when it cannot be taken yet — the caller keeps the press
## a moment and tries again. mark: where the target is (null: nobody; left
## out: the last known).
func attack(speed: float = 0.0, mark: Variant = false) -> bool:
	if not (mark is bool):
		aim = mark
	if cooldown > 0.0:
		return false
	if busy():
		if time / action.duration >= action.buffer:
			queued = true
		return queued
	# Shortly after a strike the combo goes on; otherwise a new one begins.
	if not (recovery > 0.0 and hits > 0):
		hits = 0
		side = null
		heavy = false
	if hits == 0:
		sequence += 1
	start(choose(speed))
	return true


## Drops the current move where it is.
func cancel() -> bool:
	interrupt()
	action = null
	queued = false
	return false


## A strike cut short leaves the combo open, to be picked up after a power or a parry.
func interrupt() -> void:
	if action == null or action.get("free", false) or action.get("utility", false):
		return
	side = action.to
	recovery = 0.6


## A Force power, at once, cutting short whatever the blade was doing.
func power(name: String) -> bool:
	if not moves.has(name) or not moves[name].has("power"):
		return false
	if action != null and action.has("power") and time / action.duration < 0.75:
		return false
	interrupt()
	start(name)
	return true


## The guard pressed: a quick parry, high, left or right, even out of a strike.
func parry() -> bool:
	if action != null and action.has("power"):
		return false
	var options := parries.filter(func(name: String) -> bool: return name != last_parry)
	var name: String = options[int(floorf(random.call() * options.size())) % options.size()]
	last_parry = name
	interrupt()
	start(name)
	return true


## The guard held and a bolt about to arrive: the blade snaps out to meet it
## on its side ("left", "right", "high", "back"; null: either side). A parry
## still going out on that side covers it already.
func deflect(towards = null) -> bool:
	if action != null and action.has("power"):
		return false
	var back: bool = towards == "back"
	if action != null and _has_role(action, "parry") and (action.name == "parryBack") == back:
		var done: float = time / action.duration
		if done < 0.45:
			return true
		# A burst from behind: the blade stays down his back for the next one.
		if back and done < 0.75:
			time = 0.4 * action.duration
			return true
	var name := "parryBack" if back else "parryLeft" if towards == "left" else "parryRight" if towards == "right" else "parryHigh" if towards == "high" \
		else ("parryRight" if last_parry == "parryLeft" else "parryLeft")
	last_parry = name
	interrupt()
	start(name)
	return true


## The blade goes through a trooper before him, and stays while pinned.
func impale() -> bool:
	interrupt()
	start("impale")
	pinned = true
	return true


## The power let go: the blade comes out (the move plays on to its end).
func unpin() -> bool:
	pinned = false
	return false


## B held by the transformer: the blade drawn back and held there (cocked) until loose().
func plunge() -> bool:
	interrupt()
	start("plunge")
	cocked = true
	pinned = true
	return true


## The hold is full: the thrust goes in.
func loose() -> bool:
	cocked = false
	return false


## B let go too soon: no thrust, the blade comes back down.
func uncock() -> bool:
	if action == null or action.name != "plunge":
		return false
	cocked = false
	pinned = false
	finish()
	return false


## Holding the blade in a body (the thrust has gone in, the hold goes on).
func impaling() -> bool:
	return action != null and action.name == "impale" and pinned and time / action.duration >= action.sustain[0] - 0.12


## The style twirl — never during a strike, the guard or a hold, nor twice at once.
func twirl() -> bool:
	if busy() or guard > 0.3 or force > 0.3:
		return false
	if action != null and action.name == "twirl" and time / action.duration < 0.7:
		return false
	start("twirl")
	return true


## The ignition twirl; it never interrupts a strike or the guard.
func flourish() -> bool:
	if action != null or guard > 0.3:
		return false
	start("draw")
	return true


func start(name: String) -> void:
	var move: Dictionary = moves[name]
	if name != "impale" and name != "plunge":
		pinned = false
	cocked = false
	from_pose.copy(last_pose)
	blend_from = output.weight > 0.5
	# Each strike differs a little: tempo, twist and reach vary. FEEL sets the pace.
	var plain: bool = move.get("free", false) or move.get("utility", false)
	var tempo: float = 1.0 if plain else (0.97 + random.call() * 0.06) * feel.attacks.tempo
	action = move.duplicate()
	action.name = name
	action.duration = move.duration * tempo
	action.variation = 1.0 if plain else 0.85 + random.call() * 0.3
	action.push = 1.0 if plain else 0.85 + random.call() * 0.35
	action.released = false
	if not plain:
		hits += 1
		history.append(name)
		if history.size() > 8:
			history.remove_at(0)
	time = 0.0
	queued = false
	impacted = false
	started = name
	charge = 0.0
	if _has_role(move, "finisher"):
		heavy = false


## options — guard: held; speed: the hero's; hold: a trooper held up by the
## Force (the free hand stays out, even while striking); charging: B kept
## down — through a strike, it calls the finisher; aim; lead.
func update(dt: float, options: Dictionary = {}) -> Dictionary:
	var guard_held: bool = options.get("guard", false)
	var speed: float = options.get("speed", 0.0)
	var hold: bool = options.get("hold", false)
	var charging: bool = options.get("charging", false)
	aim = options.get("aim", aim)
	lead = options.get("lead", 0.0)
	var out := output
	clock += dt
	force += ((1.0 if hold else 0.0) - force) * (1.0 - exp(-12.0 * dt))
	cooldown = maxf(0.0, cooldown - dt)
	out.shake = maxf(0.0, out.shake - dt * 4.0)
	out.flare = maxf(0.0, out.flare - dt * 5.0)
	out.lift = 0.0
	out.spin = 0.0
	out.drive = 0.0
	out.trail = 0.0
	if action != null:
		time += dt
		# A cocked move (the plunge) waits drawn back in its wind-up; a held one (the impale) in its sustain window while pinned.
		if action.has("windup") and cocked and time / action.duration > action.windup[1]:
			time = action.windup[0] * action.duration
		if action.has("sustain") and pinned and time / action.duration > action.sustain[1]:
			time = action.sustain[0] * action.duration
		var t: float = time / action.duration
		var held: bool = action.has("sustain") and pinned
		var free: bool = action.get("free", false)
		var striking: bool = not free and not action.get("utility", false)
		var finisher := _has_role(action, "finisher")
		# B held through a strike: the finisher is next.
		charge = charge + dt if striking and not finisher and charging else 0.0
		if charge >= feel.attacks.hold and not heavy:
			heavy = true
			queued = true
		if queued and not held and t >= action.chain:
			if not action.get("utility", false):
				side = action.to
			# After a finisher, a fresh combo.
			if finisher:
				hits = 0
				heavy = false
			if hits == 0:
				sequence += 1
			start(choose(speed))
		elif guard_held and not held and (free or t >= action.active[1]):
			finish()
		elif t >= 1.0:
			finish()
		if action != null:
			var current: Dictionary = action
			var at: float = time / current.duration
			sample_move(current, at, action_pose, current.variation)
			# Chained strikes start from wherever the previous one left the blade.
			if blend_from:
				action_pose.mix(from_pose, action_pose, _ease(clampf(time / 0.09, 0.0, 1.0)))
			last_pose.copy(action_pose)
			# The blade goes to the target ahead of the body: the arms' pose turned towards it, the chest a little.
			if lead != 0.0 and not current.get("free", false) and not current.get("utility", false):
				action_pose.hand = action_pose.hand.rotated(Vector3.UP, lead)
				action_pose.blade = action_pose.blade.rotated(Vector3.UP, lead)
				action_pose.left = action_pose.left.rotated(Vector3.UP, lead)
				action_pose.yaw += lead * 0.35
			if current.get("free", false):
				out.weight = clampf(time / 0.1, 0.0, 1.0) * clampf((1.0 - at) / 0.2, 0.0, 1.0)
			else:
				out.weight = minf(1.0, out.weight + dt / 0.07)
			for window in current.get("drive", []):
				if at >= window[0] and at <= window[1]:
					out.drive = window[2] * current.push * sin(PI * (at - window[0]) / (window[1] - window[0])) * 1.25
			if current.has("lift"):
				var lift: Array = current.lift
				if at > lift[0] and at < lift[1]:
					out.lift = sin(PI * (at - lift[0]) / (lift[1] - lift[0])) * lift[2]
			if current.has("spin"):
				var spin: Array = current.spin
				out.spin = _ease(clampf((at - spin[0]) / (spin[1] - spin[0]), 0.0, 1.0)) * spin[2] * PI * 2.0
			out.trail = _in_window(at, current.trail)
			if current.has("impact") and not impacted and at >= current.impact[0]:
				impacted = true
				out.shake = current.impact[1]
				out.flare = 1.0
			if current.has("power") and not current.released and at >= feel.force[current.power]:
				current.released = true
				fired = current.name
			out.name = current.name
	if action == null:
		recovery = maxf(0.0, recovery - dt)
		if recovery == 0.0:
			hits = 0
		guard += ((1.0 if guard_held else 0.0) - guard) * (1.0 - exp(-14.0 * dt))
		# Out of a strike the arms ease back to the captured motion, unless the guard takes over the pose.
		var steady := maxf(guard, force)
		out.weight = maxf(steady, out.weight - dt / 0.3)
		# A held guard (or Force hold) is alive: the hands breathe and the blade wavers.
		var stance := sway_pose.copy(guard_pose if guard >= force else hold_pose)
		stance.hand.x += sin(clock * 1.7) * 0.008
		stance.hand.y += sin(clock * 2.3) * 0.006
		stance.blade.x += sin(clock * 1.3) * 0.05
		stance.blade = stance.blade.normalized()
		mixed.mix(last_pose, stance, clampf(steady / out.weight, 0.0, 1.0) if out.weight > 0.0 else 1.0)
		action_pose.copy(mixed)
		last_pose.copy(mixed)
		out.name = "guard" if guard > 0.5 else "forceHold" if force > 0.5 else null
	elif not action.get("free", false):
		guard = 0.0
	out.hand = action_pose.hand
	out.blade = action_pose.blade
	out.left = action_pose.left
	out.grip = action_pose.grip
	out.yaw = action_pose.yaw
	out.pitch = action_pose.pitch
	out.crouch = action_pose.crouch
	# While the Force holds a trooper, the free hand stays out towards him,
	# trembling with the effort, through every strike.
	if force > 0.01:
		var left: Vector3 = (out.left as Vector3).lerp(HOLD_LEFT, force)
		left.x += sin(clock * 17.0) * 0.005 * force
		left.y += sin(clock * 13.0) * 0.005 * force
		out.left = left
		out.grip *= 1.0 - force
	out.guard = guard
	var committed := busy()
	# Powers and parries let the hero keep moving a little; strikes commit him.
	out.input_scale = (0.5 if action.get("utility", false) else 0.15) if committed else 1.0
	out.turn_scale = 0.0 if committed else 0.6 if guard > 0.5 else 1.0
	out.max_speed = INF if committed else GUARD_SPEED + (1.0 - guard) * 3.0 if guard > 0.1 else 2.8 if force > 0.1 else INF
	# A body on the blade: he can turn with it and shuffle, no more.
	if impaling():
		out.input_scale = 0.3
		out.turn_scale = 0.35
		out.max_speed = 0.8
	out.engaged = action != null or guard > 0.1 or force > 0.1
	return out


func finish() -> void:
	var ended: Dictionary = action
	action = null
	if ended.get("free", false) or ended.get("utility", false):
		return
	side = ended.to
	if _has_role(ended, "finisher"):
		hits = 0
		recovery = 0.0
		cooldown = 0.2
	else:
		recovery = 0.34
