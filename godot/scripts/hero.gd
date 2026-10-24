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
## (Enemies to strike, bolts to deflect and the Force's effects come with
## steps 3 and 4 of the migration.)
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
var skeleton: Skeleton3D
var socket: Node3D
var saber: Saber
var trail: BladeTrail
var coat: Coat
var feel: Dictionary = {}
var time := 0.0
var action: Dictionary = combat.output
## For checks without hands on the controls: a move held on the screen (x right, y up), sprinting or not,
## and presses made at given moments ({ seconds: action name }).
var autopilot := Vector2.ZERO
var autopilot_sprint := false
var autopilot_presses := {}

## A press is kept this long (FEEL.input.buffer) when it cannot be taken at once.
var _input_clock := 0.0
var _pending := { "attack": -INF, "dash": -INF, "power": -INF }
var _pending_power := ""
var _dash = null  ## { age, along } while dashing
var _dash_cooldown := 0.0
var _dash_after := 0.0
var _dodge := 0.0
var _last_shake := 0.0


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
	if trail:
		trail.clear()
	if coat:
		coat.reset()


func _pressed(name: String) -> bool:
	if Input.is_action_just_pressed(name):
		return true
	for at in autopilot_presses:
		if autopilot_presses[at] == name and time >= at and time - get_process_delta_time() < at:
			return true
	return false


func _waiting(name: String) -> bool:
	return _input_clock - _pending[name] <= feel.input.buffer


func _process(delta: float) -> void:
	time += delta
	_input_clock += delta
	var sim := delta
	var asked := Controls.move()
	if autopilot != Vector2.ZERO:
		asked = { "vector": autopilot, "analog": false, "sprint": autopilot_sprint }
	var input: Vector2 = asked.vector
	input /= maxf(1.0, input.length())
	var world_x := INPUT_RIGHT.x * input.x + INPUT_FORWARD.x * input.y
	var world_z := INPUT_RIGHT.y * input.x + INPUT_FORWARD.y * input.y
	var stick := Vector2(world_x, world_z).length() > 0.2
	var guard := Input.is_action_pressed("guard")
	var attack_held := Input.is_action_pressed("attack")

	# The dash: along the stick, or straight ahead with the stick at rest.
	_dash_cooldown = maxf(0.0, _dash_cooldown - sim)
	_dodge = maxf(0.0, _dodge - sim)
	_dash_after = maxf(0.0, _dash_after - sim)
	if _pressed("dash"):
		_pending.dash = _input_clock
	if _waiting("dash") and _dash == null and _dash_cooldown <= 0.0 and not combat.impaling():
		_pending.dash = -INF
		_start_dash(Vector3(world_x, 0, world_z).normalized() if stick else _facing())
	if _pressed("twirl"):
		combat.twirl()
	# Powers cut any strike short; a parry too; B strikes and chains.
	for power in ["force_pull", "force_push"]:
		if _pressed(power):
			_pending.power = _input_clock
			_pending_power = "forcePull" if power == "force_pull" else "forcePush"
	if _waiting("power") and combat.power(_pending_power):
		_pending.power = -INF
	if _pressed("guard"):
		combat.parry()
	if _pressed("attack"):
		_pending.attack = _input_clock
	if _waiting("attack"):
		# During the dash or just after it, the strike lunges from it.
		var rushing: bool = _dash != null or _dash_after > 0.0
		if combat.attack(maxf(motion.speed, 5.0) if rushing else motion.speed, null):
			_pending.attack = -INF
			_end_dash()
			_dash_after = 0.0
	# B kept down through a strike calls the finisher.
	action = combat.update(sim, { "guard": guard, "speed": motion.speed, "hold": false, "charging": attack_held, "aim": null, "lead": 0.0 })
	# A strike turns to the stick's way (to its mark, once there are enemies).
	var started = combat.take_start()
	if started != null and not combat.moves[started].get("utility", false) and not combat.moves[started].get("free", false) and stick:
		motion.face(atan2(world_x, world_z))
	var released = combat.take_force()
	if released != null:
		_unleash(released)

	if _dash != null:
		_dash_step(sim)
	else:
		motion.update(sim, world_x, world_z, {
			"sprint": asked.sprint and not action.engaged, "analog": asked.analog, "max_speed": action.max_speed,
			"input_scale": action.input_scale, "drive": action.drive, "turn_scale": action.turn_scale, "engaged": action.engaged,
		})
	# Crates and barrels stop him.
	if obstacles:
		var at := obstacles.push_out(Vector3(motion.x, 0, motion.z), 0.3)
		motion.x = at.x
		motion.z = at.z
	position = Vector3(motion.x, 0, motion.z)
	rotation.y = motion.heading + action.spin
	var sprint_intent: float = maxf(motion.sprint, 1.0 if asked.sprint and input.length() > 0.05 else 0.0) * (1.0 - action.guard)
	animator.update({ "dt": sim, "time": time, "speed": motion.speed, "run_blend": motion.run_blend, "sprint_intent": sprint_intent, "turn_rate": motion.turn_rate, "forward_accel": motion.forward_accel, "action": action })
	coat.begin(sim, time, Vector3(motion.vx, 0, motion.vz))
	# Igniting the blade, moving or not, comes with a quick draw twirl.
	if saber.update(motion.saber, time, action.flare) == "ignite":
		combat.flourish()
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


## The moment a power leaves his hand: the view takes the push (the troopers and the effects come later).
func _unleash(kind: String) -> void:
	if camera == null:
		return
	if kind == "forcePush":
		camera.shove(_facing(), feel.camera.kickPush)
		camera.punch(feel.camera.punchPush)
	else:
		camera.shove(-_facing() * 3.0, feel.camera.kick)
