class_name Shake
extends RefCounted
## Camera shake driven by trauma (port of src/shake.js): every blow adds some
## (0 → 1), it drains away over time, and the shake grows with its square — a
## light hit barely trembles the view, a grenade at his feet rocks it hard.
## The motion is smooth noise (not white jitter), fast for small shakes, with
## a slower sway and a touch of roll for the big ones. Offsets are in world
## units along the camera's right and up axes, sized for the pixel grid.

var max_offset := 0.34
var max_roll := 0.022
var decay := 1.25
var trauma := 0.0
var offset := Vector2.ZERO
var roll := 0.0
var amount := 0.0
var _time := 0.0
## Three smooth noise channels (x, y, roll), each a sum of detuned sines with random phases: [rate, phase, weight].
var _channels: Array = []


func _init() -> void:
	for channel in 3:
		_channels.append([
			[17.0 + randf() * 4.0, randf() * 100.0, 0.6],
			[29.0 + randf() * 6.0, randf() * 100.0, 0.3],
			[5.0 + randf() * 2.0, randf() * 100.0, 0.45],
		])


func _noise(channel: int, t: float, slow: float) -> float:
	var sum := 0.0
	var total := 0.0
	for wave in _channels[channel]:
		# The slow sway only comes in with heavy trauma.
		var weight: float = wave[2] * slow if wave[0] < 10.0 else wave[2]
		sum += sin(t * wave[0] + wave[1]) * weight
		total += weight
	return sum / total if total > 0.0 else 0.0


## A blow: adds trauma (it never goes past 1).
func add(value: float) -> void:
	trauma = minf(1.0, trauma + maxf(0.0, value))


## At least this much (a blow that should not stack with the last).
func at_least(value: float) -> void:
	trauma = maxf(trauma, minf(1.0, value))


## Real seconds (it rings through hit stops).
func update(dt: float) -> void:
	_time += dt
	trauma = maxf(0.0, trauma - decay * dt)
	var shake := trauma * trauma
	var slow := smoothstep(0.35, 0.9, trauma)
	amount = shake
	offset = Vector2(_noise(0, _time, slow), _noise(1, _time, slow)) * (max_offset * shake)
	roll = _noise(2, _time, slow) * max_roll * shake * slow


func clear() -> void:
	trauma = 0.0
	offset = Vector2.ZERO
	roll = 0.0
	amount = 0.0
