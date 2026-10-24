class_name CameraRig
extends Camera3D
## The game's view: orthographic, from (8, 8.2, 10) above and behind the point
## it follows, easing after the hero (a little wider while he runs); the wheel
## brings it closer or further (a view 5 to 12 m high), R recentres.
## Game feel, as main.js: blows add trauma (Shake), a kick knocks the view
## along a swing or a push and rings out, a punch zooms in a touch, fast, and
## eases back.

const OFFSET := Vector3(8, 8.2, 10)

var target: Node3D
var focus := Vector3(0, 0.6, 0)
var view_height := 8.2
var desired_height := 8.2
var trauma := Shake.new()
var _kick_direction := Vector3.ZERO
var _kick_amplitude := 0.0
var _kick_age := INF
var _punch_amount := 0.0
var _punch_age := INF


func _ready() -> void:
	projection = PROJECTION_ORTHOGONAL
	keep_aspect = KEEP_HEIGHT
	size = view_height
	near = 0.1
	far = 100.0
	_aim(Vector3.ZERO, 0.0)


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed:
		if event.button_index == MOUSE_BUTTON_WHEEL_UP:
			desired_height = clampf(desired_height - 0.6, 5.0, 12.0)
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			desired_height = clampf(desired_height + 0.6, 5.0, 12.0)
	if event.is_action_pressed("recentre") and target:
		focus = target.global_position + Vector3(0, 0.6, 0)


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
	var running := 0.0
	if target:
		var hero := target as Hero
		var lead := Vector3(hero.motion.vx, 0, hero.motion.vz) * 0.16 if hero else Vector3.ZERO
		running = hero.motion.run_blend if hero else 0.0
		var wanted := target.global_position + lead + Vector3(0, 0.6, 0)
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


func _aim(shake: Vector3, roll: float) -> void:
	global_position = focus + OFFSET + shake
	look_at(focus + shake, Vector3.UP)
	if roll != 0.0:
		rotate_object_local(Vector3.BACK, roll)
