class_name CameraRig
extends Camera3D
## The game's view: orthographic, from (8, 8.2, 10) above and behind the point
## it follows, easing after the hero; the wheel brings it closer or further
## (a view 5 to 12 m high), R recentres.

const OFFSET := Vector3(8, 8.2, 10)

var target: Node3D
var focus := Vector3(0, 0.6, 0)
var view_height := 8.2
var desired_height := 8.2


func _ready() -> void:
	projection = PROJECTION_ORTHOGONAL
	keep_aspect = KEEP_HEIGHT
	size = view_height
	near = 0.1
	far = 100.0
	_aim()


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed:
		if event.button_index == MOUSE_BUTTON_WHEEL_UP:
			desired_height = clampf(desired_height - 0.6, 5.0, 12.0)
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			desired_height = clampf(desired_height + 0.6, 5.0, 12.0)
	if event.is_action_pressed("recentre") and target:
		focus = target.global_position + Vector3(0, 0.6, 0)


func _process(delta: float) -> void:
	if target:
		var hero := target as Hero
		var lead := Vector3(hero.motion.vx, 0, hero.motion.vz) * 0.16 if hero else Vector3.ZERO
		var wanted := target.global_position + lead + Vector3(0, 0.6, 0)
		focus = focus.lerp(wanted, 1.0 - exp(-7.0 * delta))
	view_height = lerpf(view_height, desired_height, 1.0 - exp(-8.0 * delta))
	size = view_height
	_aim()


func _aim() -> void:
	global_position = focus + OFFSET
	look_at(focus, Vector3.UP)
