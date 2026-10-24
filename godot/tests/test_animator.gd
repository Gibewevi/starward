extends TestCase
## The animator's port against the JavaScript: a scripted stand, walk, sprint
## with a turn, slow walk must give the same bone rotations and hips, step
## after step, on the baked Jedi's skeleton.

func _hero() -> Dictionary:
	var scene: PackedScene = load("res://assets/baked/hero.glb")
	var root := scene.instantiate()
	var skeletons := root.find_children("*", "Skeleton3D", true, false)
	var sockets := root.find_children("Saber socket*", "Node3D", true, false)
	return { "root": root, "skeleton": skeletons[0] if skeletons else null, "socket": sockets[0] if sockets else null }


func test_the_baked_jedi_has_its_skeleton_and_saber_socket() -> void:
	var hero := _hero()
	check(hero.skeleton != null, "pas de squelette")
	if hero.skeleton:
		check(hero.skeleton.get_bone_count() == 22, "22 os (%d)" % hero.skeleton.get_bone_count())
		check(hero.skeleton.find_bone("RightHand") >= 0, "une main droite")
	check(hero.socket != null, "pas de fourreau de sabre")
	hero.root.free()


func test_replays_the_javascript_pose() -> void:
	var reference := data("animator-reference.json")
	var hero := _hero()
	var animator := HeroAnimator.new(hero.skeleton, hero.socket)
	animator.update({ "dt": 0.0, "time": 0.0 })
	var frame := 0
	var worst_angle := 0.0
	var worst_hips := 0.0
	var worst_phase := 0.0
	for i in reference.steps.size():
		var step: Dictionary = reference.steps[i]
		animator.update({ "dt": step.dt, "time": step.time, "speed": step.speed, "run_blend": step.runBlend, "sprint_intent": step.sprintIntent, "turn_rate": step.turnRate, "forward_accel": step.forwardAccel })
		if frame < reference.frames.size() and int(reference.frames[frame].step) == i:
			var expected: Dictionary = reference.frames[frame]
			for k in animator.names.size():
				var q: Array = expected.quaternions[k]
				worst_angle = maxf(worst_angle, _angle(animator.rotations[k], Quaternion(q[0], q[1], q[2], q[3])))
			var h: Array = expected.hips
			worst_hips = maxf(worst_hips, animator.positions[animator.index.Hips].distance_to(Vector3(h[0], h[1], h[2])))
			worst_phase = maxf(worst_phase, absf(animator.state.phase - expected.phase))
			frame += 1
	check(frame == reference.frames.size(), "toutes les images comparées (%d)" % frame)
	check(worst_angle < 0.002, "écart d'angle maximal %f rad" % worst_angle)
	check(worst_hips < 0.002, "écart des hanches %f m" % worst_hips)
	check(worst_phase < 0.002, "écart de phase %f" % worst_phase)
	hero.root.free()


## The angle between two rotations, well conditioned near zero (the reference is rounded, so not quite unit).
static func _angle(a: Quaternion, b: Quaternion) -> float:
	var d := a.normalized().inverse() * b.normalized()
	return 2.0 * atan2(Vector3(d.x, d.y, d.z).length(), absf(d.w))
