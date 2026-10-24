class_name CameraRig
extends Camera3D
## The game's view: orthographic, from (8, 8.2, 10) above and behind the point
## it follows, easing after the hero (a little wider while he runs); the wheel
## brings it closer or further (a view 5 to 12 m high), R recentres.
## Game feel, as main.js: blows add trauma (Shake), a kick knocks the view
## along a swing or a push and rings out, a punch zooms in a touch, fast, and
## eases back. In a fight it leans a little towards the squad (lean_toward), so
## the shooters stay in frame.
##
## First person (Select, or V): the view from the hero's eyes, in perspective —
## his head out of the way, his arms and blade in view. The right stick or the
## mouse looks round; the moves go where he looks. The eyes follow his head
## smoothed, and walking or running sways the view with his steps (lower on
## each footfall, side to side with the stride, a touch of roll), more as he
## runs; sprinting widens the view a little. Blows, kicks and punches shake it
## as they do the iso view.

const OFFSET := Vector3(8, 8.2, 10)
## First person: the field of view, how fast the stick and the mouse turn it, how far it looks up and down.
const FOV := 72.0
const STICK_TURN := 2.6
const STICK_PITCH := 1.7
const MOUSE_TURN := 0.0032
const PITCH_LIMITS := Vector2(-1.25, 0.95)

var target: Node3D
var focus := Vector3(0, 0.6, 0)
var view_height := 8.2
var desired_height := 8.2
var trauma := Shake.new()
var lean := Vector3.ZERO
## Where the view sits off the hero (the jungle keeps him below centre, its paths leading into the view).
var stage_offset := Vector3.ZERO
var _kick_direction := Vector3.ZERO
var _kick_amplitude := 0.0
var _kick_age := INF
var _punch_amount := 0.0
var _punch_age := INF
## First person: on or not, where the view looks (yaw as the hero's heading, pitch up positive), the eyes smoothed.
var first_person := false
var view_yaw := 0.0
var view_pitch := -0.08
var _eye := Vector3.ZERO
var _eye_ready := false
var _sway := 0.0


func _ready() -> void:
	projection = PROJECTION_ORTHOGONAL
	keep_aspect = KEEP_HEIGHT
	size = view_height
	near = 0.1
	far = 100.0
	_aim(Vector3.ZERO, 0.0)


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("view"):
		set_first_person(not first_person)
		get_viewport().set_input_as_handled()
		return
	if first_person and event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		view_yaw -= event.relative.x * MOUSE_TURN
		view_pitch = clampf(view_pitch - event.relative.y * MOUSE_TURN, PITCH_LIMITS.x, PITCH_LIMITS.y)
		return
	if event is InputEventMouseButton and event.pressed:
		if event.button_index == MOUSE_BUTTON_WHEEL_UP:
			desired_height = clampf(desired_height - 0.6, 5.0, 12.0)
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			desired_height = clampf(desired_height + 0.6, 5.0, 12.0)
	if event.is_action_pressed("recentre") and target:
		focus = target.global_position + Vector3(0, 0.6, 0)


## First person on or off: the view from his eyes (looking where he faces), or back over the room.
func set_first_person(on: bool) -> void:
	first_person = on
	var hero := target as Hero
	if on:
		projection = PROJECTION_PERSPECTIVE
		fov = FOV
		near = 0.04
		view_yaw = hero.motion.heading if hero else 0.0
		view_pitch = -0.08
		_eye_ready = false
	else:
		projection = PROJECTION_ORTHOGONAL
		size = view_height
		near = 0.1
		if target:
			focus = target.global_position + Vector3(0, 0.6, 0)
	if hero:
		hero.hide_head(on)
		if hero.manual:
			Input.mouse_mode = Input.MOUSE_MODE_CAPTURED if on else Input.MOUSE_MODE_VISIBLE


## Leans the view towards `toward` (an offset on the floor), easing there over the fight's time.
func lean_toward(toward: Vector3, dt: float) -> void:
	lean = lean.lerp(toward, 1.0 - exp(-1.6 * dt))


## A kick along a velocity (the view knocked that way, a little down), unless a stronger one is still ringing.
func shove(velocity: Vector3, amplitude: float) -> void:
	if amplitude < _kick_amplitude * maxf(0.0, 1.0 - _kick_age / 0.3):
		return
	_kick_direction = Vector3(velocity.x, 0, velocity.z)
	_kick_direction = _kick_direction.normalized() if _kick_direction.length_squared() > 1e-6 else Vector3.DOWN
	_kick_direction.y -= 0.35
	_kick_amplitude = amplitude
	_kick_age = 0.0


## The zoom punched in by `amount` (a fraction of the view), unless a bigger punch is under way.
func punch(amount: float) -> void:
	if amount >= _punch_amount * (1.0 if _punch_age < 0.3 else 0.0):
		_punch_amount = amount
		_punch_age = 0.0


## A kick that hits at once and rings out: a damped oscillation, 0 at rest (tween.js's kick).
static func kick(age: float, duration: float = 0.3, frequency: float = 13.0) -> float:
	if not (age < duration):
		return 0.0
	var k := clampf(age / duration, 0.0, 1.0)
	return sin(TAU * frequency * age) * (1.0 - k) * (1.0 - k)


func _process(delta: float) -> void:
	if first_person:
		_first_person_step(delta)
		return
	var running := 0.0
	if target:
		var hero := target as Hero
		var lead := Vector3(hero.motion.vx, 0, hero.motion.vz) * 0.16 if hero else Vector3.ZERO
		running = hero.motion.run_blend if hero else 0.0
		var wanted := target.global_position + lead + lean + stage_offset + Vector3(0, 0.6, 0)
		focus = focus.lerp(wanted, 1.0 - exp(-7.0 * delta))
	view_height = lerpf(view_height, desired_height + running * 0.24, 1.0 - exp(-6.0 * delta))
	# Zoom punch: in fast, out slowly.
	_punch_age += delta
	var punched := 1.0 - pow(1.0 - _punch_age / 0.05, 2) if _punch_age < 0.05 else 1.0 - (1.0 - cos(PI * minf(1.0, (_punch_age - 0.05) / 0.3))) / 2.0
	size = view_height * (1.0 - _punch_amount * punched)
	# The shake: trauma along the view's own axes; the kick rings out in real time too.
	trauma.update(delta)
	var shake := global_basis.x * trauma.offset.x + global_basis.y * trauma.offset.y
	_kick_age += delta
	shake += _kick_direction * (_kick_amplitude * kick(_kick_age, 0.3, 11.0))
	_aim(shake, trauma.roll)


## The view from his eyes: looked round with the right stick (the mouse moves it as it comes), swaying with his steps.
func _first_person_step(delta: float) -> void:
	var hero := target as Hero
	if hero == null:
		return
	# The right stick looks round (the mouse is taken as it moves, in _unhandled_input); kept on the mouse while playing.
	if hero.manual:
		if Input.mouse_mode != Input.MOUSE_MODE_CAPTURED and not get_tree().paused:
			Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
		for pad in Input.get_connected_joypads():
			var x := Input.get_joy_axis(pad, JOY_AXIS_RIGHT_X)
			var y := Input.get_joy_axis(pad, JOY_AXIS_RIGHT_Y)
			if absf(x) > 0.18:
				view_yaw -= signf(x) * pow((absf(x) - 0.18) / 0.82, 1.6) * STICK_TURN * delta
			if absf(y) > 0.18:
				view_pitch = clampf(view_pitch - signf(y) * pow((absf(y) - 0.18) / 0.82, 1.6) * STICK_PITCH * delta, PITCH_LIMITS.x, PITCH_LIMITS.y)
	# The eyes: where his head is, smoothed (the capture's own head bob would jitter it).
	var eye := hero.eye_position()
	_eye = eye if not _eye_ready else _eye.lerp(eye, 1.0 - exp(-14.0 * delta))
	_eye_ready = true
	# His steps: lower on each footfall (twice a stride), side to side with the stride, a touch of roll; more as he runs.
	var state: Dictionary = hero.animator.state
	var moving: float = state.motion if not hero.dashing() else 0.0
	var running: float = state.running
	_sway = lerpf(_sway, moving, 1.0 - exp(-8.0 * delta))
	var amplitude := lerpf(0.014, 0.032, running) * _sway
	var phase: float = state.phase * TAU
	var right := Vector3(-cos(view_yaw), 0, sin(view_yaw))
	var step := Vector3.UP * (-amplitude * cos(phase * 2.0)) + right * (sin(phase) * amplitude * 0.7)
	var step_roll := sin(phase) * 0.012 * _sway * (1.0 + running)
	# Shakes and kicks, as over the room (a touch smaller: they are right at his eyes).
	trauma.update(delta)
	_kick_age += delta
	var view := Basis.from_euler(Vector3(view_pitch, view_yaw + PI, 0.0))
	var shake := (view.x * trauma.offset.x + view.y * trauma.offset.y) * 0.5
	shake += _kick_direction * (_kick_amplitude * kick(_kick_age, 0.3, 11.0) * 0.6)
	global_transform = Transform3D(view, _eye + step + shake)
	var roll := trauma.roll * 0.6 + step_roll
	if roll != 0.0:
		rotate_object_local(Vector3.BACK, roll)
	# Sprinting widens the view a little; a punch narrows it, fast, and lets it go.
	_punch_age += delta
	var punched := 1.0 - pow(1.0 - _punch_age / 0.05, 2) if _punch_age < 0.05 else 1.0 - (1.0 - cos(PI * minf(1.0, (_punch_age - 0.05) / 0.3))) / 2.0
	var sprint: float = state.sprint * moving
	fov = (FOV + 7.0 * sprint) * (1.0 - _punch_amount * punched * 2.0)


func _aim(shake: Vector3, roll: float) -> void:
	global_position = focus + OFFSET + shake
	look_at(focus + shake, Vector3.UP)
	if roll != 0.0:
		rotate_object_local(Vector3.BACK, roll)
