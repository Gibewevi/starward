class_name Hero
extends Node3D
## The Jedi: the baked model (assets/baked/hero.glb), moved by the motion
## controller from the controls, animated from motion capture, kept out of
## the crates; his long coat simulated, his lightsaber in his hand — lit while
## he moves, drawn back after a second standing still — and the sword work of
## the web version (main.js): strikes chained into combos and the finisher
## when B is held, the guard and its parries, the dash, the twirl, the Force
## pull and push, the draw flourish when the blade comes on, the glowing
## trail of every cut, the view kicked by a push or a finisher.
##
## Against the squad (Battle): a strike finds its mark — the trooper nearest
## the stick's way, or ahead — turns to him and glides in to striking
## distance; the Force throws them (push) or drags them in (pull), and with
## the pull kept down (LT / U) he hangs in the air before the hero; LT and B
## held, the blade runs him through. A clean cut freezes the action for a beat
## (stop_for), then eases back to speed: `sim` is this frame's time once
## slowed. What he does makes noise the squad hears. Standing troopers stop
## him like the crates do. Thrown off his feet by a blast (Battle's
## HeroRagdoll), he has no control until he is up again; dead, none at all,
## his blade going out.
##
## Screen directions on the floor: right is (10, −8), up (−8, −10) — the iso
## camera's axes — so pushing up walks away from the view.

const INPUT_RIGHT := Vector2(0.780869, -0.624695)
const INPUT_FORWARD := Vector2(-0.624695, -0.780869)

var motion := MotionController.new()
var combat := CombatController.new()
var animator: HeroAnimator
var obstacles: Obstacles
var camera: CameraRig
var battle: Battle
var skeleton: Skeleton3D
var socket: Node3D
var saber: Saber
var trail: BladeTrail
var coat: Coat
var feel: Dictionary = {}
## Where he starts (and starts again): { x, z, heading }.
var home := { "x": 0.0, "z": 0.0, "heading": NAN }
var time := 0.0
## This frame's time, once slowed by a hit stop.
var sim := 0.0
var action: Dictionary = combat.output
## For checks without hands on the controls: a move held on the screen (x right, y up), sprinting or not,
## and presses made at given moments ({ seconds: action name }), or held from one to another ({ seconds: "hold:<action>" … "release:<action>" }).
var autopilot := Vector2.ZERO
## False for checks: the keyboard and the pads are not listened to (only the autopilot).
var manual := true
var autopilot_sprint := false
var autopilot_presses := {}
var _autopilot_held := {}

## A press is kept this long (FEEL.input.buffer) when it cannot be taken at once.
var _pending := { "attack": -INF, "dash": -INF, "power": -INF }
var _pending_power := ""
var _dash = null  ## { age, along } while dashing
var _dash_cooldown := 0.0
var _dash_after := 0.0
var _strike_from_dash := false
var _dodge := 0.0
var _last_shake := 0.0
var _hit_stop: Variant = null  ## { age, hold, recover }
var _step_clock := 0.0
var _hum_clock := 0.0
## The trooper held up by the Force (the pull kept down), and whether it is.
var held: Stormtrooper
var _pull_held := false
## The trooper a queued blow goes for; the strike's turn to him and its glide in; the blade's lead.
var _intent: Stormtrooper
var _turn: Variant = null
var _lunge: Variant = null
var _lead := 0.0
## LT and B held: the thrust building up; the trooper on the blade.
var _thrust: Variant = null
var _skewered: Variant = null  ## { trooper, entered, depth }
var _gush_clock := 0.0
var _attack_pressed := false
## Real time, for the input buffer and the unseen grace of a late parry.
var input_clock := 0.0
## The perfect parry: when the guard was last pressed (a press too soon after the last opens no window), and the burst it sends back.
var parry_at := -INF
var parry_try := -INF
var perfect_until := -INF
## Off his feet (a blast) or dead: no control.
var _down := false
## By the transformer, B held: { age, phase ("cocking", "thrust"), hold, crackle, entered, from, to }.
var plunge: Variant = null
## Nodes that follow his bones (for what sticks to him: drips).
var _bone_nodes := {}


func _ready() -> void:
	feel = CombatController._load("res://assets/data/feel.json")
	var model: Node3D = (load("res://assets/baked/hero.glb") as PackedScene).instantiate()
	add_child(model)
	skeleton = model.find_children("*", "Skeleton3D", true, false)[0]
	socket = model.find_children("Saber socket*", "Node3D", true, false)[0]
	_grade(model)
	saber = Saber.new()
	saber.name = "Lightsaber"
	socket.add_child(saber)
	animator = HeroAnimator.new(skeleton, socket)
	animator.update({ "dt": 0.0, "time": 0.0 })
	trail = BladeTrail.new()
	trail.name = "Blade trail"
	add_child(trail)
	place(0.0, 0.0)
	coat = Coat.new(animator, skeleton, self)
	coat.name = "Coat"
	add_child(coat)


## His cloth, skin and hair take the characters' light grade (shaders/character.gdshader); the metal stays as it is.
static func _grade(model: Node) -> void:
	var shader: Shader = load("res://shaders/character.gdshader")
	for mesh in model.find_children("*", "MeshInstance3D", true, false):
		mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
		if mesh.mesh == null:
			continue
		for surface in mesh.mesh.get_surface_count():
			var material := mesh.mesh.surface_get_material(surface) as BaseMaterial3D
			if material == null or material.metallic > 0.5:
				continue
			var graded := ShaderMaterial.new()
			graded.shader = shader
			graded.set_shader_parameter("tint", material.albedo_color)
			graded.set_shader_parameter("use_vertex_colour", (mesh.mesh.surface_get_format(surface) & Mesh.ARRAY_FORMAT_COLOR) != 0)
			mesh.set_surface_override_material(surface, graded)


func place(x: float, z: float, heading: float = NAN) -> void:
	motion.reset()
	motion.x = x
	motion.z = z
	if not is_nan(heading):
		motion.heading = heading
	position = Vector3(x, 0, z)
	rotation.y = motion.heading
	combat.reset()
	_dash = null
	_turn = null
	_lunge = null
	_intent = null
	_thrust = null
	_skewered = null
	held = null
	_hit_stop = null
	if trail:
		trail.clear()
	if coat:
		coat.reset()


## Back to the start (a restart): the middle of the lab, or the stage's own spot.
func restart() -> void:
	place(home.x, home.z, home.heading)


## A beat of slow motion: nearly frozen for `hold` seconds, then eased back to full speed over `recover`.
func stop_for(hold: float, recover: float) -> void:
	if _hit_stop == null or hold + recover > _hit_stop.hold + _hit_stop.recover - _hit_stop.age:
		_hit_stop = { "age": 0.0, "hold": hold, "recover": recover }


## Time scale through a hit stop (tween.js's hitStopScale).
static func hit_stop_scale(age: float, hold: float, recover: float, floor_scale: float = 0.04) -> float:
	if age < hold:
		return floor_scale
	return floor_scale + (1.0 - floor_scale) * Stormtrooper.ease_by("inOutSine", clampf((age - hold) / recover, 0.0, 1.0))


func _pressed(name: String) -> bool:
	if _down:
		return false
	if manual and Input.is_action_just_pressed(name):
		return true
	for at in autopilot_presses:
		if autopilot_presses[at] == name and time >= at and time - sim < at:
			return true
	return false


## Held down (by hand, or by the autopilot between its "hold:" and "release:").
func _held(name: String) -> bool:
	if _down:
		return false
	return (manual and Input.is_action_pressed(name)) or _autopilot_held.get(name, false)


## Dead, a press to try again: Enter (Start), or a strike, the guard, a dash.
func retry_pressed() -> bool:
	for name in ["retry", "attack", "guard", "dash"]:
		if manual and InputMap.has_action(name) and Input.is_action_just_pressed(name):
			return true
		for at in autopilot_presses:
			if autopilot_presses[at] == name and time >= at and time - sim < at:
				return true
	return false


## Where one of his bones is now, in the world.
func bone_position(bone: String) -> Vector3:
	return skeleton.global_transform * animator.globals[animator.index[bone]].origin


## A node that follows one of his bones.
func bone_node(bone: String) -> Node3D:
	if not _bone_nodes.has(bone):
		var attachment := BoneAttachment3D.new()
		attachment.name = "On %s" % bone
		attachment.bone_name = bone
		skeleton.add_child(attachment)
		_bone_nodes[bone] = attachment
	return _bone_nodes[bone]


## Knocked off his feet or killed: whatever he was doing is dropped (the trooper on his blade, the one held up, the strike).
func let_go() -> void:
	if _skewered != null:
		var blade := saber.segment()
		_unskewer(blade[1] - blade[0])
	combat.reset()
	trail.clear()
	_dash = null
	_lunge = null
	_turn = null
	_intent = null
	_thrust = null
	if held:
		held.drop()
		held = null


func _waiting(name: String) -> bool:
	return input_clock - _pending[name] <= feel.input.buffer


## First person: his head out of the view (its bone shrunk to nothing: the hair and the face with it), or back.
func hide_head(hidden: bool) -> void:
	var bone := skeleton.find_bone("Head")
	if bone >= 0:
		skeleton.set_bone_pose_scale(bone, Vector3.ONE * (0.001 if hidden else 1.0))


## Where his eyes are, in the world: on his head as the pose has it (not shrunk).
func eye_position() -> Vector3:
	return skeleton.global_transform * (animator.globals[animator.index.Head] * Vector3(0, 0.1, 0.18))


## Dashing (and a beat after): bolts pass through him.
func dodging() -> bool:
	return _dodge > 0.0


## In the middle of a dash.
func dashing() -> bool:
	return _dash != null


## The guard pressed: the window of a perfect parry opens — unless pressed again and again.
func _parry_press() -> void:
	if time - parry_try > feel.deflect.mash or time <= perfect_until + 0.2:
		parry_at = time
	parry_try = time


func _noise(at: Vector3, radius: float, options: Dictionary = {}) -> void:
	if battle:
		battle.noise(at, radius, options)


func _troopers() -> Array:
	return battle.troopers if battle else []


func _process(delta: float) -> void:
	# A clean cut freezes the action for a beat, then eases back to speed.
	sim = delta * (hit_stop_scale(_hit_stop.age, _hit_stop.hold, _hit_stop.recover) if _hit_stop != null else 1.0)
	if _hit_stop != null:
		_hit_stop.age += delta
		if _hit_stop.age > _hit_stop.hold + _hit_stop.recover:
			_hit_stop = null
	time += sim
	input_clock += delta
	var knockdown: HeroRagdoll = battle.knockdown if battle else null
	_down = knockdown != null and knockdown.active()
	# Dead: his blade goes out as he falls.
	if battle and battle.death != null:
		motion.saber = maxf(0.0, motion.saber - sim * 3.0)
	for at in autopilot_presses:
		var press: String = autopilot_presses[at]
		if time >= at and time - sim < at and press.contains(":"):
			_autopilot_held[press.get_slice(":", 1)] = press.begins_with("hold")
	var asked: Dictionary = Controls.move() if manual else { "vector": Vector2.ZERO, "analog": false, "sprint": false }
	if autopilot != Vector2.ZERO:
		asked = { "vector": autopilot, "analog": false, "sprint": autopilot_sprint }
	var input: Vector2 = asked.vector
	input /= maxf(1.0, input.length())
	var world_x := INPUT_RIGHT.x * input.x + INPUT_FORWARD.x * input.y
	var world_z := INPUT_RIGHT.y * input.x + INPUT_FORWARD.y * input.y
	# First person: the stick goes where he looks (up ahead, right to his right).
	if camera and camera.first_person:
		var yaw: float = camera.view_yaw
		world_x = -cos(yaw) * input.x + sin(yaw) * input.y
		world_z = sin(yaw) * input.x + cos(yaw) * input.y
	var stick := Vector2(world_x, world_z).length() > 0.2
	var guard := _held("guard")
	var attack_held := _held("attack")
	_pull_held = _held("force_pull")
	_attack_pressed = _pressed("attack")
	var here := Vector3(motion.x, 0, motion.z)

	# The dash: along the stick, or straight ahead with the stick at rest.
	_dash_cooldown = maxf(0.0, _dash_cooldown - sim)
	_dodge = maxf(0.0, _dodge - sim)
	_dash_after = maxf(0.0, _dash_after - sim)
	if _pressed("dash"):
		_pending.dash = input_clock
	if _waiting("dash") and _dash == null and _dash_cooldown <= 0.0 and _skewered == null and not combat.impaling():
		_pending.dash = -INF
		_start_dash(Vector3(world_x, 0, world_z).normalized() if stick else _facing())
	if _pressed("twirl"):
		combat.twirl()
	# Powers cut any strike short; a parry too; B strikes and chains.
	_keep_hold()
	_impale_input(delta, attack_held)
	# The guard: held, or just pressed (a parry, the window of a perfect one).
	var parry_pressed := _pressed("guard")
	if parry_pressed:
		_parry_press()
	if battle:
		battle.auto_parry(guard or time - parry_try < 0.3)
	for power in ["force_pull", "force_push"]:
		if _pressed(power):
			_pending.power = input_clock
			_pending_power = "forcePull" if power == "force_pull" else "forcePush"
	if _waiting("power") and combat.power(_pending_power):
		_pending.power = -INF
	if parry_pressed:
		combat.parry()
	_plunge_input(delta, attack_held)
	if _attack_pressed:
		_pending.attack = input_clock
	# Where the next blow would go: the strike is chosen to reach him (ahead, aside, behind).
	if _intent != null and (_intent.dead or _intent.is_impaled()):
		_intent = null
	var mark: Variant = _mark_of(_intent) if _intent != null else _find_mark(world_x, world_z, _dash != null or _dash_after > 0.0 or _strike_from_dash)
	var aim: Variant = { "angle": mark.angle, "distance": mark.distance } if mark != null else null
	if _waiting("attack"):
		# During the dash or just after it, the strike lunges from it.
		var rushing: bool = _dash != null or _dash_after > 0.0
		# Pressed towards someone else than the one the current blow goes for: he is the next one.
		var pressed: Variant = _find_mark(world_x, world_z, rushing)
		if combat.attack(maxf(motion.speed, 5.0) if rushing else motion.speed, { "angle": pressed.angle, "distance": pressed.distance } if pressed != null else null):
			_intent = pressed.trooper if pressed != null else null
			_pending.attack = -INF
			_strike_from_dash = rushing
			_end_dash()
			_dash_after = 0.0
	# B kept down through a strike calls the finisher (not while running a trooper through).
	action = combat.update(sim, { "guard": guard, "speed": motion.speed, "hold": held != null, "charging": attack_held and _thrust == null and _skewered == null, "aim": aim, "lead": _lead })
	# A strike finds its mark; other moves let the turn go.
	var started = combat.take_start()
	if started != null and not (started as String).begins_with("force") and not (started as String).begins_with("parry"):
		_noise(here, 3.5, { "from": here })
	var strike: bool = started != null and combat.moves.has(started) and not combat.moves[started].get("utility", false) and not combat.moves[started].get("free", false)
	if strike:
		_lock_on(started, world_x, world_z, _mark_of(_intent) if _intent != null else mark)
		_intent = null
	elif started != null:
		_turn = null
		_lead = 0.0
	var released = combat.take_force()
	if released != null:
		_unleash(released)

	if _down:
		# Thrown by a blast: where the ragdoll's hips are.
		var at := knockdown.position()
		var moving := knockdown.velocity()
		motion.x = at.x
		motion.z = at.z
		motion.vx = moving.x
		motion.vz = moving.z
		motion.speed = 0.0
	elif _dash != null:
		_dash_step(sim)
	else:
		motion.update(sim, world_x, world_z, {
			"sprint": asked.sprint and not action.engaged, "analog": asked.analog, "max_speed": action.max_speed,
			"input_scale": action.input_scale, "drive": action.drive, "turn_scale": action.turn_scale, "engaged": action.engaged,
		})
		_lunge_step(sim)
		_turn_step()
	# Standing troopers stop him.
	for trooper: Stormtrooper in _troopers():
		var block: Variant = trooper.blocker()
		if block == null or _down:
			continue
		var dx: float = motion.x - block.x
		var dz: float = motion.z - block.z
		var distance := sqrt(dx * dx + dz * dz)
		var reach: float = block.radius + 0.24
		if distance < reach and distance > 1e-4:
			motion.x = block.x + dx / distance * reach
			motion.z = block.z + dz / distance * reach
	# Crates and barrels stop him.
	if obstacles and not _down:
		var at := obstacles.push_out(Vector3(motion.x, 0, motion.z), 0.3)
		motion.x = at.x
		motion.z = at.z
	if _down:
		# The ragdoll lays his skeleton out; once up, the motion capture takes over again.
		var up: Variant = knockdown.update(sim, time)
		if up != null:
			motion.x = up.x
			motion.z = up.z
			motion.heading = up.heading
			motion.vx = 0.0
			motion.vz = 0.0
			motion.speed = 0.0
			battle._blade_ready = false
	else:
		position = Vector3(motion.x, battle.ground_at(motion.x, motion.z) if battle else 0.0, motion.z)
		rotation.y = motion.heading + action.spin
		var sprint_intent: float = maxf(motion.sprint, 1.0 if asked.sprint and input.length() > 0.05 else 0.0) * (1.0 - action.guard)
		animator.update({ "dt": sim, "time": time, "speed": motion.speed, "run_blend": motion.run_blend, "sprint_intent": sprint_intent, "turn_rate": motion.turn_rate, "forward_accel": motion.forward_accel, "action": action })
		# His feet push the scraps on the floor about.
		if battle:
			battle.debris.kick(position, Vector3(motion.vx, 0, motion.vz))
	coat.begin(sim, time, Vector3(motion.vx, 0, motion.vz))
	# Igniting the blade, moving or not, comes with a quick draw twirl.
	if saber.update(motion.saber, time, action.flare) == "ignite":
		combat.flourish()
		_noise(position, 3.5, { "from": position })
	# In the dark the blade lights more of the room round him.
	var dark: float = battle.blade_dark() if battle else 0.0
	for index in saber.lights.size():
		saber.lights[index].light_energy *= 1.0 + 0.8 * dark
		saber.lights[index].omni_range = [3.2, 2.6][index] + 2.2 * dark
	# Footsteps: a run heard close by, a sprint further; the blade's hum only right next to him.
	_step_clock -= sim
	_hum_clock -= sim
	if motion.speed > 2.4 and _step_clock <= 0.0:
		_step_clock = 0.3
		_noise(position, 5.5 if motion.sprint > 0.5 else 3.2, { "from": position })
	if motion.saber > 0.5 and _hum_clock <= 0.0:
		_hum_clock = 0.6
		_noise(position, 1.4, { "from": position, "strength": 0.6 })
	var blade := saber.segment()
	trail.update(sim, blade[0], blade[1], action.trail * motion.saber)
	# A finisher landing jolts the view.
	if camera and action.shake > _last_shake + 0.05:
		camera.trauma.add(action.shake * 0.5)
	_last_shake = action.shake


func _facing() -> Vector3:
	return Vector3(sin(motion.heading), 0, cos(motion.heading))


## The dash (Space / Y): a lightning burst along the ground, off at full speed, easing to a stop after a few metres.
func _start_dash(along: Vector3) -> void:
	_dash = { "age": 0.0, "along": along }
	_dash_cooldown = feel.dash.cooldown
	_dodge = feel.dash.duration + feel.dash.dodge
	motion.face(atan2(along.x, along.z))
	if camera:
		camera.shove(along, feel.camera.kick * 0.6)
	var here := Vector3(motion.x, 0, motion.z)
	_noise(here, 6.0, { "from": here })


func _dash_step(dt: float) -> void:
	_dash.age += dt
	var k := minf(1.0, _dash.age / feel.dash.duration)
	var v: float = feel.dash.speed * (1.0 - k * k * k)
	var along: Vector3 = _dash.along
	motion.vx = along.x * v
	motion.vz = along.z * v
	motion.x += motion.vx * dt
	motion.z += motion.vz * dt
	motion.speed = v
	motion.run_blend = 1.0
	motion.sprint = 1.0
	motion.idle_time = 0.0
	if k >= 1.0:
		_end_dash()


## The dash ends (run out, or cut short by a strike): he keeps a little of it into his stride.
func _end_dash() -> void:
	if _dash == null:
		return
	var along: Vector3 = _dash.along
	motion.vx = along.x * feel.dash.speed * feel.dash.carry
	motion.vz = along.z * feel.dash.speed * feel.dash.carry
	_dash = null
	_dash_after = feel.dash.strike


# ---- Finding the mark ----------------------------------------------------------
# A strike turns to the trooper nearest the stick's way (ahead of him with the
# stick at rest) and glides in to striking distance before the blade lands,
# turning with him if he moves. Out of a dash it reaches further.

## The trooper a strike now would go for: the nearest to the stick's way (ahead
## of him with the stick at rest — or, nobody there, one close behind him).
## With where he is from the hero: { trooper, angle (rad, + to his left), distance }.
func _find_mark(world_x: float, world_z: float, rushing: bool) -> Variant:
	var assist: Dictionary = feel.assist
	var stick := Vector2(world_x, world_z).length() > 0.2
	var along := Vector3(world_x, 0, world_z).normalized() if stick else _facing()
	var reach: float = assist.dashRange if rushing else assist.range
	var cone: float = assist.cone if stick else assist.coneIdle
	var here := Vector3(motion.x, 0, motion.z)
	var best: Stormtrooper = null
	var best_score := INF
	var behind: Stormtrooper = null
	var behind_distance: float = feel.choreography.near
	for trooper: Stormtrooper in _troopers():
		if trooper.dead or trooper.is_impaled():
			continue
		var offset := Battle.where_is(trooper) - here
		var distance := offset.length()
		if distance > reach:
			continue
		var angle := 0.0 if distance < 0.4 else SquadMind._angle(along, offset)
		if angle > cone:
			if not stick and not trooper.fallen and distance < behind_distance:
				behind_distance = distance
				behind = trooper
			continue
		var score := angle * 1.6 + distance * 0.35 + (0.7 if trooper.fallen else 0.0) - (1.0 if trooper == held else 0.0)
		if score < best_score:
			best_score = score
			best = trooper
	if best == null:
		best = behind
	return _mark_of(best) if best != null else null


## Where a trooper is from the hero: distance, and angle from his facing (rad, + to his left).
func _mark_of(trooper: Stormtrooper) -> Dictionary:
	var offset := Battle.where_is(trooper) - Vector3(motion.x, 0, motion.z)
	return { "trooper": trooper, "distance": offset.length(), "angle": MotionController.angle_delta(motion.heading, atan2(offset.x, offset.z)) }


func _lock_on(move_name: String, world_x: float, world_z: float, mark: Variant) -> void:
	var assist: Dictionary = feel.assist
	var rushing := _strike_from_dash
	_strike_from_dash = false
	_lunge = null
	_turn = null
	_lead = 0.0
	if mark == null:
		if Vector2(world_x, world_z).length() > 0.2:
			motion.face(atan2(world_x, world_z))
		return
	var move: Dictionary = combat.moves[move_name]
	var playing: Variant = combat.action
	var gap := clampf(mark.distance - assist.reach, 0.0, assist.dashStep if rushing else assist.step)
	_lunge = { "trooper": mark.trooper, "age": 0.0, "duration": assist.lunge * (1.35 if gap > 1.6 else 1.0), "gap": gap, "done": 0.0, "track": playing.active[0] * playing.duration if playing != null else 0.15 }
	# Nearly ahead: he squares up to him at once. Further round: the body turns during the blow.
	if absf(mark.angle) < 0.5 and not move.has("turn"):
		motion.face(motion.heading + mark.angle)
		return
	var window: Array = move.turn if move.has("turn") else [0.0, minf(0.7, move.active[0] + feel.choreography.turnUntil)]
	_turn = { "trooper": mark.trooper, "name": move_name, "from": motion.heading, "window": window, "back": move.get("back") }
	_lunge.track = 0.0


## Each frame of a turning strike: the heading eased round to the target (tracked if he moves), the blade's lead.
func _turn_step() -> void:
	_lead = 0.0
	if _turn == null:
		return
	var playing: Variant = combat.action
	var trooper: Stormtrooper = _turn.trooper
	if playing == null or playing.name != _turn.name or (trooper.dead and not trooper.fallen):
		_turn = null
		return
	var at := Battle.where_is(trooper)
	var want := atan2(at.x - motion.x, at.z - motion.z)
	var delta := MotionController.angle_delta(_turn.from, want)
	# A turning cut goes round its own way, even the long way.
	if _turn.back == "right" and delta > 0.0:
		delta -= TAU
	if _turn.back == "left" and delta < 0.0:
		delta += TAU
	var from: float = _turn.window[0]
	var to: float = _turn.window[1]
	var k := clampf((combat.time / playing.duration - from) / (to - from), 0.0, 1.0)
	var eased := Stormtrooper.ease_by("inOutCubic" if _turn.back != null else "outQuad", k)
	motion.heading = _turn.from + delta * eased
	var c: Dictionary = feel.choreography
	var off := MotionController.angle_delta(motion.heading, want)
	# Side blows: the blade turns towards him ahead of the body. The thrust behind: aimed at him, behind the back.
	if _turn.back == null:
		_lead = clampf(off * c.lead, -c.maxLead, c.maxLead)
	elif _turn.back == "thrust" and k == 0.0:
		_lead = clampf(MotionController.angle_delta((signf(off) if off != 0.0 else 1.0) * PI, off), -0.6, 0.6)
	if k >= 1.0:
		_turn = null


## Each frame of a locked strike: the glide in, the turn with the target until the blade lands.
func _lunge_step(dt: float) -> void:
	if _lunge == null:
		return
	var trooper: Stormtrooper = _lunge.trooper
	if not combat.busy() or trooper.dead:
		_lunge = null
		return
	_lunge.age += dt
	var offset := Battle.where_is(trooper) - Vector3(motion.x, 0, motion.z)
	var distance := offset.length()
	if distance < 1e-3:
		_lunge = null
		return
	offset /= distance
	if _lunge.age < _lunge.track:
		motion.heading += MotionController.angle_delta(motion.heading, atan2(offset.x, offset.z)) * (1.0 - exp(-24.0 * dt))
	var k := minf(1.0, _lunge.age / _lunge.duration)
	var reach: float = Stormtrooper.ease_by("outCubic", k) * _lunge.gap
	# Never into him: he stops at striking distance even if the man came forward.
	var step := minf(reach - _lunge.done, maxf(0.0, distance - feel.assist.reach * 0.85))
	_lunge.done = reach
	if step > 0.0:
		motion.x += offset.x * step
		motion.z += offset.z * step
	if k >= 1.0 and _lunge.age >= _lunge.track:
		_lunge = null


# ---- The Force ---------------------------------------------------------------------

## The trooper the hero means: closest to his line of sight, alive ones first.
func _target(reach: float, cone: float) -> Stormtrooper:
	var here := Vector3(motion.x, 0, motion.z)
	var facing := _facing()
	var best: Stormtrooper = null
	var score := INF
	for trooper: Stormtrooper in _troopers():
		var offset := Battle.where_is(trooper) - here
		var distance := offset.length()
		if distance > reach or distance < 0.3:
			continue
		var angle := SquadMind._angle(facing, offset)
		if angle > cone:
			continue
		var value := angle * 2.2 + distance * 0.12 + (0.6 if trooper.dead else 0.0)
		if value < score:
			score = value
			best = trooper
	return best


## Where the pulled trooper hangs: before the hero, at chest height.
func _hold_point() -> Vector3:
	var hold: Dictionary = feel.pull.hold
	return Vector3(motion.x + sin(motion.heading) * hold.distance, hold.height, motion.z + cos(motion.heading) * hold.distance)


## LT / U kept down: the pulled trooper hangs before the hero; let go, he drops.
func _keep_hold() -> void:
	if held == null:
		return
	if not _pull_held or held.dead:
		held.drop()
		held = null
		return
	var point := _hold_point()
	held.hold(point, atan2(motion.x - point.x, motion.z - point.z))


## The moment a power leaves his hand: the troopers in the cone thrown (push), or the one he means dragged in (pull).
func _unleash(kind: String) -> void:
	var here := Vector3(motion.x, 0, motion.z)
	var facing := _facing()
	var left_hand := bone_position("LeftHand")
	if kind == "forcePush":
		# Everyone in the cone is thrown, the nearest hardest.
		var push: Dictionary = feel.push
		for trooper: Stormtrooper in _troopers():
			var offset := Battle.where_is(trooper) - here
			var distance := offset.length()
			if distance > push.range or distance < 0.05 or SquadMind._angle(facing, offset) > push.cone:
				continue
			var strength := lerpf(1.0, push.falloff, distance / push.range)
			var direction := (offset.normalized() + facing).normalized()
			var throw := direction * (Feel.pick(push.speed) * strength)
			throw.y = Feel.pick(push.lift) * strength
			trooper.force_push(throw)
		if battle:
			battle.effects.wave(left_hand, facing, { "kind": "push", "length": push.range * 0.8 })
			if battle.jungle:
				battle.jungle.force("push", here, facing, push.range, push.cone)
			# Grenades are swept away; the scraps on the floor too.
			battle.grenades.push(here, facing, push.range, push.cone)
			battle.debris.blast(here - facing * 0.6, push.range * 0.7, 0.45)
		_noise(here, 8.5, { "alarm": true, "from": here })
		if camera:
			camera.shove(facing, feel.camera.kickPush)
			camera.punch(feel.camera.punchPush)
	else:
		var pull: Dictionary = feel.pull
		var trooper := _target(pull.range, pull.cone)
		var toward := Battle.where_is(trooper) - here if trooper else facing * 3.0
		var distance := maxf(0.1, toward.length())
		if trooper and _pull_held:
			if held and held != trooper:
				held.drop()
			if trooper.force_pull(_hold_point(), true):
				held = trooper
		elif trooper:
			trooper.force_pull(here + toward.normalized() * minf(pull.stop, distance))
		if battle:
			battle.effects.wave(left_hand, toward, { "kind": "pull", "length": distance })
			if battle.jungle:
				battle.jungle.force("pull", here, toward, pull.range, pull.cone)
		_noise(here, 8.5, { "alarm": true, "from": here })
		if camera:
			camera.shove(-toward, feel.camera.kick)


# ---- Running a trooper through --------------------------------------------------
# LT and B held, a trooper before him: the blade goes through him. A quick tap
# of B still strikes; held a moment, it runs the trooper through. He struggles
# on the blade, dies there, and hangs from it until LT is let go.

## The living trooper the blade can reach before him: the one held up by the Force first.
func _victim() -> Stormtrooper:
	if held and not held.dead and not held.fallen:
		return held
	var trooper := _target(feel.impale.reach, feel.impale.cone)
	return trooper if trooper and not trooper.dead and not trooper.fallen else null


func is_skewering(trooper: Stormtrooper) -> bool:
	return _skewered != null and _skewered.trooper == trooper


func _impale_input(dt: float, attack_held: bool) -> void:
	if _skewered != null:
		_thrust = null
		return
	if _attack_pressed and _pull_held and _victim():
		_thrust = { "age": 0.0 }
		_attack_pressed = false
	if _thrust == null:
		return
	_thrust.age += dt
	if not attack_held:
		_thrust = null
		_attack_pressed = true
		return
	if _thrust.age < feel.impale.press:
		return
	_thrust = null
	var trooper := _victim()
	if trooper == null:
		_attack_pressed = true
		return
	if held == trooper:
		held = null
	var at := Battle.where_is(trooper)
	motion.face(atan2(at.x - motion.x, at.z - motion.z))
	combat.impale()
	_skewered = { "trooper": trooper, "entered": false, "depth": 0.7 }


## Off the blade: the body drops (a living one dies of it as he falls).
func _unskewer(axis: Vector3) -> void:
	if _skewered == null:
		return
	var trooper: Stormtrooper = _skewered.trooper
	_skewered = null
	combat.unpin()
	if trooper.is_impaled():
		var drop := axis * 0.4
		drop.y = -0.3
		trooper.slide_off(drop)


## Each frame while the thrust goes in and the body is on the blade (after the squad has thought).
func keep_skewer(dt: float) -> void:
	if _skewered == null:
		return
	var trooper: Stormtrooper = _skewered.trooper
	var blade := saber.segment()
	var base: Vector3 = blade[0]
	var axis: Vector3 = blade[1] - base
	var length := axis.length()
	if length < 0.2:
		_unskewer(axis)
		return
	axis /= length
	var moving: bool = combat.action != null and combat.action.name == "impale"
	if not _skewered.entered:
		# The blade goes in as the thrust lands; his chest slides onto it where it passes him.
		if not moving or not _pull_held:
			_skewered = null
			combat.unpin()
			return
		if combat.time / combat.action.duration < 0.17:
			return
		var chest_at := Battle.where_is(trooper)
		chest_at.y = base.y
		_skewered.depth = clampf((chest_at - base).dot(axis), 0.45, length * 0.8)
		var wound: Vector3 = base + axis * _skewered.depth
		if not trooper.impale(wound, motion.heading):
			_skewered = null
			combat.unpin()
			return
		_skewered.entered = true
		var stop: Array = feel.impale.hitStop
		stop_for(stop[0], stop[1])
		if camera:
			camera.punch(feel.camera.punch * 1.6)
			camera.shove(axis, feel.camera.kick)
			camera.trauma.add(0.32)
		_noise(wound, 9.0, { "alarm": true, "from": position, "source": trooper })
		return
	# LT let go, or the blade taken elsewhere (a power, a blast): the body comes off.
	if not _pull_held or not moving or not trooper.is_impaled():
		_unskewer(axis)
		return
	var wound: Vector3 = base + axis * _skewered.depth
	trooper.skewer(wound, motion.heading)
	# While he fights, spurts of sparks from the wound, fewer as he weakens.
	_gush_clock -= dt
	if not trooper.dead and _gush_clock <= 0.0 and battle:
		_gush_clock = Feel.pick(feel.impale.gush)
		var across := axis.cross(Vector3.UP).normalized()
		var out := randf() < 0.6
		var spurt := (axis * (1.0 if out else -1.0) + Vector3.UP * 0.4).normalized()
		battle.effects.sparks(wound + axis * (0.2 if out else -0.2), spurt, across, { "count": 5 + roundi(randf() * 6.0), "speed": 2.4, "saber": 0.3 })


# ---- Running the blade into the transformer -----------------------------------
# B pressed by the transformer: he draws the blade far back along his right
# side, both hands on the hilt, the arc crackling at it more and more; let go
# too soon and he lowers it. The hold full, he drives it straight in; it
# surges (Battle and Transformer take it from there), then blows.

func _transformer() -> Transformer:
	return battle.transformer if battle else null


func _start_plunge() -> void:
	var t := _transformer()
	var s := t.socket
	var a := t.approach
	plunge = { "age": 0.0, "phase": "cocking", "hold": 0.0, "crackle": 0.0, "entered": false, "from": Vector3(motion.x, 0, motion.z), "to": a }
	motion.face(atan2(s.x - a.x, s.z - a.z))
	motion.vx = 0.0
	motion.vz = 0.0
	_dash = null
	_lunge = null
	_turn = null
	combat.plunge()


## B pressed by the transformer starts the wind-up; held to the end, the thrust; let go before, nothing.
func _plunge_input(dt: float, attack_held: bool) -> void:
	var t := _transformer()
	if t == null:
		return
	if plunge != null and plunge.phase == "cocking":
		# Let go, thrown, or another move took over: he lowers the blade.
		if _down or not attack_held or combat.action == null or combat.action.name != "plunge":
			combat.uncock()
			plunge = null
			return
		plunge.hold += dt
		var k := minf(1.0, plunge.hold / float(feel.sabotage.hold))
		var s := t.socket
		var out := t.facing
		# The tension: the arc crackling at the blade, faster and harder.
		plunge.crackle -= dt
		if plunge.crackle <= 0.0:
			plunge.crackle = 0.3 - 0.16 * k
			battle.effects.sparks(s + out * 0.06, Vector3(out.x, 0.3 + randf() * 0.4, out.z).normalized(), Vector3(out.z, 0, -out.x), { "count": roundi(1.0 + 4.0 * k), "speed": 1.0 + 2.0 * k, "saber": 0.6 })
		if k >= 1.0:
			plunge.phase = "thrust"
			combat.loose()
		return
	# (The blade off after a moment standing still: it lights as he draws it back.)
	if _attack_pressed and not _down and plunge == null and battle.death == null and not combat.busy():
		for candidate in battle.transformers:
			if candidate.reachable(Vector3(motion.x, 0, motion.z)):
				battle.transformer = candidate
				_attack_pressed = false
				_start_plunge()
				return


## Each frame (after the squad): the quick step before the window, the blade going in.
func plunge_step(dt: float) -> void:
	if plunge == null:
		return
	var t := _transformer()
	plunge.age += dt
	# A quick step to just before the window, squared up to it.
	var k := Stormtrooper.ease_by("outCubic", minf(1.0, plunge.age / 0.14))
	motion.x = lerpf(plunge.from.x, plunge.to.x, k)
	motion.z = lerpf(plunge.from.z, plunge.to.z, k)
	var s := t.socket
	motion.heading = atan2(s.x - motion.x, s.z - motion.z)
	var playing: Variant = combat.action
	if not plunge.entered and plunge.phase == "thrust" and playing != null and playing.name == "plunge" and combat.time / playing.duration >= playing.impact[0] - 0.01:
		plunge.entered = true
		t.begin()
		# The blade goes in: a jolt, a gush of blue and molten sparks, a crack of electricity.
		var out := t.facing
		var effects := battle.effects
		effects.sparks(s + out * 0.06, Vector3(out.x, 0.4, out.z).normalized(), Vector3(out.z, 0, -out.x), { "count": 60, "speed": 5.5, "saber": 0.6 })
		effects.flash(s, 1.8, { "color": Color(0.55, 0.75, 1) })
		effects.burst(s, { "normal": out, "power": 1.3, "tint": "blue" })
		stop_for(0.12, 0.2)
		if camera:
			camera.punch(feel.camera.punch * 1.4)
			camera.shove(-out, feel.camera.kick)
			camera.trauma.add(0.25)
		_noise(s, 9.0, { "alarm": true, "from": s })
	# Pinned while it surges.
	if plunge.entered and t.state != "surging":
		plunge = null


## The transformer blew: the blade comes out.
func end_plunge() -> void:
	combat.unpin()
	plunge = null
