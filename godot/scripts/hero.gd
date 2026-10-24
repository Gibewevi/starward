class_name Hero
extends Node3D
## The Jedi: the baked model (assets/baked/hero.glb), moved by the motion
## controller from the controls, animated from motion capture, kept out of
## the crates; his lightsaber in his hand, lit while he moves, drawn back
## after a second standing still (as in the web version).
##
## Screen directions on the floor: right is (10, −8), up (−8, −10) — the iso
## camera's axes — so pushing up walks away from the view.

const INPUT_RIGHT := Vector2(0.780869, -0.624695)
const INPUT_FORWARD := Vector2(-0.624695, -0.780869)

var motion := MotionController.new()
var animator: HeroAnimator
var obstacles: Obstacles
var skeleton: Skeleton3D
var socket: Node3D
var saber: Node3D
var blade: Node3D
var time := 0.0
## For checks without hands on the controls: a move held on the screen (x right, y up), sprinting or not.
var autopilot := Vector2.ZERO
var autopilot_sprint := false


func _ready() -> void:
	var model: Node3D = (load("res://assets/baked/hero.glb") as PackedScene).instantiate()
	add_child(model)
	skeleton = model.find_children("*", "Skeleton3D", true, false)[0]
	socket = model.find_children("Saber socket*", "Node3D", true, false)[0]
	_grade(model)
	saber = (load("res://assets/baked/saber.glb") as PackedScene).instantiate()
	Glow.restore(saber, "saber.glb")
	socket.add_child(saber)
	blade = _find_blade(saber)
	animator = HeroAnimator.new(skeleton, socket)
	animator.update({ "dt": 0.0, "time": 0.0 })
	place(0.0, 0.0)


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


## The blade: the part of the saber above the hilt's emitter (everything glowing grows out of it).
static func _find_blade(root: Node) -> Node3D:
	for node in root.find_children("*", "Node3D", true, false):
		if node.position.y > 0.1 and node.get_child_count() > 0:
			return node
	return null


func place(x: float, z: float, heading: float = NAN) -> void:
	motion.reset()
	motion.x = x
	motion.z = z
	if not is_nan(heading):
		motion.heading = heading
	position = Vector3(x, 0, z)
	rotation.y = motion.heading


func _process(delta: float) -> void:
	time += delta
	var asked := Controls.move()
	if autopilot != Vector2.ZERO:
		asked = { "vector": autopilot, "analog": false, "sprint": autopilot_sprint }
	var input: Vector2 = asked.vector
	var world_x := INPUT_RIGHT.x * input.x + INPUT_FORWARD.x * input.y
	var world_z := INPUT_RIGHT.y * input.x + INPUT_FORWARD.y * input.y
	motion.update(delta, world_x, world_z, { "sprint": asked.sprint, "analog": asked.analog })
	# Crates and barrels stop him.
	if obstacles:
		var at := obstacles.push_out(Vector3(motion.x, 0, motion.z), 0.3)
		motion.x = at.x
		motion.z = at.z
	position = Vector3(motion.x, 0, motion.z)
	rotation.y = motion.heading
	animator.update({ "dt": delta, "time": time, "speed": motion.speed, "run_blend": motion.run_blend, "sprint_intent": motion.sprint, "turn_rate": motion.turn_rate, "forward_accel": motion.forward_accel })
	# The blade: out while he moves, drawn back into the hilt after a second still.
	if blade:
		blade.visible = motion.saber > 0.01
		blade.scale = Vector3(1, maxf(motion.saber, 0.001), 1)
