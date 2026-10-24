extends Node
## The controls (autoload `Controls`), as in the web version: ZQSD / WASD
## (by key position, so either keyboard layout works) or the arrows to move,
## Shift to sprint; on a gamepad the left stick, its tilt setting the pace.
## Actions are registered here rather than in project.godot, to stay readable.

const ACTIONS := {
	"move_left": [KEY_A, KEY_LEFT],
	"move_right": [KEY_D, KEY_RIGHT],
	"move_up": [KEY_W, KEY_UP],
	"move_down": [KEY_S, KEY_DOWN],
	"sprint": [KEY_SHIFT],
	"restart": [KEY_T],
	"recentre": [KEY_R],
}
const STICK := {
	"move_left": [JOY_AXIS_LEFT_X, -1.0],
	"move_right": [JOY_AXIS_LEFT_X, 1.0],
	"move_up": [JOY_AXIS_LEFT_Y, -1.0],
	"move_down": [JOY_AXIS_LEFT_Y, 1.0],
}


func _init() -> void:
	for action in ACTIONS:
		if not InputMap.has_action(action):
			InputMap.add_action(action, 0.16)
		for key in ACTIONS[action]:
			var event := InputEventKey.new()
			# By position: W on a QWERTY keyboard is Z on an AZERTY one.
			event.physical_keycode = key
			InputMap.action_add_event(action, event)
	for action in STICK:
		var motion := InputEventJoypadMotion.new()
		motion.axis = STICK[action][0]
		motion.axis_value = STICK[action][1]
		InputMap.action_add_event(action, motion)
	var stick_press := InputEventJoypadButton.new()
	stick_press.button_index = JOY_BUTTON_LEFT_STICK
	InputMap.action_add_event("restart", stick_press)


## The move asked for, on the screen: x right, y up; and whether it came from a stick (its tilt is the pace).
static func move() -> Dictionary:
	var keys := Vector2(
		float(Input.is_physical_key_pressed(KEY_D) or Input.is_physical_key_pressed(KEY_RIGHT)) - float(Input.is_physical_key_pressed(KEY_A) or Input.is_physical_key_pressed(KEY_LEFT)),
		float(Input.is_physical_key_pressed(KEY_W) or Input.is_physical_key_pressed(KEY_UP)) - float(Input.is_physical_key_pressed(KEY_S) or Input.is_physical_key_pressed(KEY_DOWN)))
	var stick := Vector2.ZERO
	for pad in Input.get_connected_joypads():
		var raw := Vector2(Input.get_joy_axis(pad, JOY_AXIS_LEFT_X), -Input.get_joy_axis(pad, JOY_AXIS_LEFT_Y))
		if raw.length() > stick.length():
			stick = raw
	# The stick's dead zone, then its tilt rescaled from there.
	var analog := stick.length() > 0.16
	if analog:
		stick *= minf(1.0, (stick.length() - 0.16) / 0.8) / stick.length()
	else:
		stick = Vector2.ZERO
	return { "vector": keys + stick, "analog": analog and keys == Vector2.ZERO, "sprint": Input.is_action_pressed("sprint") }
