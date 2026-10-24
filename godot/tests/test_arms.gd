extends TestCase
## The sword arms against the JavaScript: the scripted fight's poses fed to
## the Jedi (standing, then running a moment) must bend his arms, twist his
## torso and aim his blade as the web version does — the two-bone IK of both
## hands, the free hand on the hilt for two-handed blows.

func _vector(values: Array) -> Vector3:
	return Vector3(values[0], values[1], values[2])


func _angle(a: Quaternion, b: Quaternion) -> float:
	return 2.0 * acos(clampf(absf(a.normalized().dot(b.normalized())), 0.0, 1.0))


func test_the_hilt_sits_in_the_right_hand() -> void:
	var root: Node = (load("res://assets/baked/hero.glb") as PackedScene).instantiate()
	var socket: Node3D = root.find_children("Saber socket*", "Node3D", true, false)[0]
	check(socket.position.distance_to(Vector3(-0.05, -0.004, 0.006)) < 1e-4, "la poignée au creux de la main (%s)" % socket.position)
	root.free()


func test_replays_the_javascript_arms() -> void:
	var reference := data("arms-reference.json")
	var root: Node = (load("res://assets/baked/hero.glb") as PackedScene).instantiate()
	var skeleton: Skeleton3D = root.find_children("*", "Skeleton3D", true, false)[0]
	var socket: Node3D = root.find_children("Saber socket*", "Node3D", true, false)[0]
	var animator := HeroAnimator.new(skeleton, socket)
	animator.update({ "dt": 0.0, "time": 0.0 })
	var frame := 0
	var worst := 0.0
	var worst_bone := ""
	var worst_socket := 0.0
	for i in reference.steps.size():
		var step: Dictionary = reference.steps[i]
		var pose: Dictionary = step.action
		var action := { "hand": _vector(pose.hand), "blade": _vector(pose.blade), "left": _vector(pose.left), "grip": pose.grip, "yaw": pose.yaw, "pitch": pose.pitch, "crouch": pose.crouch, "weight": pose.weight, "lift": pose.lift }
		animator.update({ "dt": step.dt, "time": step.time, "speed": step.speed, "run_blend": step.runBlend, "sprint_intent": step.sprintIntent, "turn_rate": step.turnRate, "forward_accel": step.forwardAccel, "action": action })
		if frame < reference.frames.size() and int(reference.frames[frame].step) == i:
			var expected: Dictionary = reference.frames[frame]
			for k in animator.names.size():
				var q: Array = expected.quaternions[k]
				var angle := _angle(animator.rotations[k], Quaternion(q[0], q[1], q[2], q[3]))
				if angle > worst:
					worst = angle
					worst_bone = "%s au pas %d" % [animator.names[k], i]
			var s: Array = expected.socket
			worst_socket = maxf(worst_socket, _angle(socket.quaternion, Quaternion(s[0], s[1], s[2], s[3])))
			frame += 1
	check(frame == reference.frames.size(), "toutes les images comparées")
	check(worst < 0.003, "écart d'os %f rad (%s)" % [worst, worst_bone])
	check(worst_socket < 0.003, "écart de lame %f rad" % worst_socket)
	root.free()
