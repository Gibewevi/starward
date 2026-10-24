class_name MotionController
extends RefCounted
## Frame-rate independent movement, kept apart from rendering for checking
## (port of src/motion.js — same constants, same formulas; tests/test_motion.gd
## replays a trace of the JavaScript and must land on the same numbers).
## Paced for the hero's short legs, so captured steps keep a natural cadence.

const SLOW_WALK_SPEED := 0.6
const WALK_SPEED := 1.7
const RUN_SPEED := 3.3
const SPRINT_SPEED := 4.5
const IDLE_SABER_DELAY := 1.0

var x := 0.0
var z := 0.0
var vx := 0.0
var vz := 0.0
var speed := 0.0
var run_blend := 0.0
var sprint := 0.0
var heading := 1.85
var turn_rate := 0.0
var forward_accel := 0.0
var idle_time := 0.0
var saber := 1.0


static func angle_delta(from: float, to: float) -> float:
	return atan2(sin(to - from), cos(to - from))


static func damp(a: float, b: float, rate: float, dt: float) -> float:
	return a + (b - a) * (1.0 - exp(-rate * dt))


static func _ease(value: float) -> float:
	return value * value * (3.0 - 2.0 * value)


## Analogue stick: slow walk → brisk walk → run → sprint at full tilt, continuously.
static func speed_for_tilt(tilt: float) -> float:
	tilt = clampf(tilt, 0.0, 1.0)
	if tilt <= 0.0:
		return 0.0
	if tilt < 0.5:
		return SLOW_WALK_SPEED + (WALK_SPEED - SLOW_WALK_SPEED) * _ease(tilt / 0.5)
	if tilt < 0.8:
		return WALK_SPEED + (RUN_SPEED - WALK_SPEED) * _ease((tilt - 0.5) / 0.3)
	if tilt < 0.95:
		return RUN_SPEED + (SPRINT_SPEED - RUN_SPEED) * _ease((tilt - 0.8) / 0.15)
	return SPRINT_SPEED


func reset() -> void:
	x = 0.0; z = 0.0; vx = 0.0; vz = 0.0; speed = 0.0; run_blend = 0.0; sprint = 0.0
	heading = 1.85
	turn_rate = 0.0
	forward_accel = 0.0
	idle_time = 0.0
	saber = 1.0


## options: { sprint, analog, max_speed, input_scale, drive (m/s pushed along the facing), turn_scale, engaged }.
func update(dt: float, input_x: float, input_z: float, options: Dictionary = {}) -> MotionController:
	var wants_sprint: bool = options.get("sprint", false)
	var analog: bool = options.get("analog", false)
	var max_speed: float = options.get("max_speed", INF)
	var input_scale: float = options.get("input_scale", 1.0)
	var drive: float = options.get("drive", 0.0)
	var turn_scale: float = options.get("turn_scale", 1.0)
	var engaged: bool = options.get("engaged", false)
	dt = minf(maxf(dt, 0.0), 1.0 / 20.0)
	var raw_length := Vector2(input_x, input_z).length()
	var magnitude := minf(1.0, raw_length)
	if raw_length > 0.0:
		input_x /= raw_length
		input_z /= raw_length
	var desired := minf(max_speed, speed_for_tilt(magnitude) if analog else magnitude * (SPRINT_SPEED if wants_sprint else WALK_SPEED)) * input_scale
	var target_x := input_x * desired + sin(heading) * drive
	var target_z := input_z * desired + cos(heading) * drive
	var previous_vx := vx
	var previous_vz := vz
	var responsiveness := 30.0 if drive != 0.0 else (18.0 if magnitude > 0.01 else 24.0)
	vx = damp(vx, target_x, responsiveness, dt)
	vz = damp(vz, target_z, responsiveness, dt)
	if magnitude < 0.01 and drive == 0.0 and Vector2(vx, vz).length() < 0.015:
		vx = 0.0
		vz = 0.0
	x += vx * dt
	z += vz * dt
	var bound := 32.0
	if absf(x) > bound:
		x = signf(x) * bound
		vx = 0.0
	if absf(z) > bound:
		z = signf(z) * bound
		vz = 0.0
	speed = Vector2(vx, vz).length()
	var previous_heading := heading
	if magnitude > 0.04 and turn_scale > 0.0:
		var target_heading := atan2(input_x, input_z)
		heading += angle_delta(heading, target_heading) * (1.0 - exp(-18.0 * turn_scale * dt))
	turn_rate = damp(turn_rate, angle_delta(previous_heading, heading) / dt if dt > 0.0 else 0.0, 12.0, dt)
	# Acceleration informs posture: the body pitches into a launch and absorbs
	# braking, instead of a run loop being played on a rigid upright figure.
	var projected := ((vx - previous_vx) * sin(heading) + (vz - previous_vz) * cos(heading)) / dt if dt > 0.0 else 0.0
	forward_accel = damp(forward_accel, clampf(projected, -35.0, 35.0), 18.0, dt)
	# The gait changes from walking to running near 2 m/s on these legs.
	run_blend = damp(run_blend, clampf((speed - 1.9) / 1.1, 0.0, 1.0), 18.0, dt)
	sprint = damp(sprint, clampf((speed - RUN_SPEED) / (SPRINT_SPEED - RUN_SPEED), 0.0, 1.0), 18.0, dt)
	idle_time = idle_time + dt if speed < 0.04 and magnitude < 0.01 and not engaged else 0.0
	var target_saber := 0.0 if idle_time >= IDLE_SABER_DELAY else 1.0
	saber = damp(saber, target_saber, 38.0 if target_saber > 0.0 else 34.0, dt)
	if saber < 0.003:
		saber = 0.0
	if saber > 0.997:
		saber = 1.0
	return self


## Turns towards an angle immediately (attacks re-aim at their start).
func face(angle: float) -> void:
	heading = heading + angle_delta(heading, angle)
