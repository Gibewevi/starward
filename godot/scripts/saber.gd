class_name Saber
extends Node3D
## The lightsaber in the hand (port of src/saber.js): the baked hilt and blue
## blade (assets/baked/saber.glb) along the socket's +Y axis, with its two
## moving lights. update(ignition 0..1, time, flare 0..1) drives the blade:
## switched on, it shoots out of the emitter in a fraction of a second,
## slightly overshooting, and is drawn back in when switched off. It returns
## "ignite" or "retract" on the frame either starts. A flare brightens it for
## an impact. segment() gives the lit blade, in the world.

const IGNITE_TIME := 0.3
const RETRACT_TIME := 0.22
const LENGTH := 0.9
## three.js point-light intensities to Godot light energy (as the lab's lamps).
const LIGHT_SCALE := 0.35

var blade: Node3D
var emitter: Node3D
var lights: Array[OmniLight3D] = []
var extension := 1.0
var lit := true
var burst := 0.0
var _last_time := NAN


func _ready() -> void:
	var model: Node3D = (load("res://assets/baked/saber.glb") as PackedScene).instantiate()
	add_child(model)
	Glow.restore(model, "saber.glb")
	for node in model.find_children("*", "Node3D", true, false):
		if node.position.y > 0.1 and node.get_child_count() > 0:
			blade = node
			break
	if blade:
		for child in blade.get_children():
			if child is Node3D and child.position.y < 0.05:
				emitter = child
	# Held low, the blade lights the floor more than the coat.
	for setting in [[Color("2671ff"), 5.0, 3.2], [Color("2375ff"), 4.0, 2.6]]:
		var light := OmniLight3D.new()
		light.top_level = true
		light.light_color = setting[0]
		light.light_energy = setting[1] * LIGHT_SCALE
		light.omni_range = setting[2]
		light.omni_attenuation = 1.7
		# A soft glint on the steel deck rather than two mirror spots.
		light.light_specular = 0.3
		light.shadow_enabled = false
		add_child(light)
		lights.append(light)


static func _ease_out_back(t: float) -> float:
	return 1.0 + 2.4 * pow(t - 1.0, 3) + 1.4 * pow(t - 1.0, 2)


func update(ignition: float, time: float, flare: float = 0.0) -> String:
	var dt := 0.0 if is_nan(_last_time) else clampf(time - _last_time, 0.0, 0.1)
	_last_time = time
	var event := ""
	var on := ignition > 0.5
	if on != lit:
		lit = on
		event = "ignite" if on else "retract"
		if on:
			burst = 1.0
	extension = clampf(extension + (dt / IGNITE_TIME if lit else -dt / RETRACT_TIME), 0.0, 1.0)
	burst = maxf(0.0, burst - dt * 5.0)
	var shown := _ease_out_back(extension) if lit else extension * extension
	if blade == null:
		return event
	blade.scale = Vector3(1, maxf(shown, 0.0001), 1)
	blade.visible = shown > 0.005
	if emitter:
		emitter.scale = Vector3(0.04, 0.06, 0.04) * (minf(1.0, extension * 3.0) * (1.0 + burst * 0.8))
	var frame := blade.global_transform
	lights[0].global_position = frame * Vector3(0, LENGTH * 0.42, 0)
	lights[1].global_position = frame * Vector3(0, LENGTH * 0.9, 0)
	var pulse := 1.0 + sin(time * 38.0) * 0.025 + sin(time * 71.0) * 0.015
	var glow := minf(1.0, shown) * pulse
	lights[0].light_energy = 5.0 * LIGHT_SCALE * glow * (1.0 + flare * 2.5 + burst * 1.5)
	lights[1].light_energy = 4.5 * LIGHT_SCALE * glow * (1.0 + flare * 4.0)
	for light in lights:
		light.visible = glow > 0.001
	return event


## The lit blade in the world: [base, tip].
func segment() -> Array[Vector3]:
	if blade == null:
		return [global_position, global_position]
	var frame := blade.global_transform
	return [frame.origin, frame * Vector3(0, LENGTH, 0)]
