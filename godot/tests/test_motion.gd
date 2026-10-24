extends TestCase
## The motion controller's port against the JavaScript: the same inputs, step
## after step (walk, run, sprint, stick, the drive of a strike, varying frame
## times), must give the same position, heading, speed and blends.

func test_replays_the_javascript_trace() -> void:
	var reference := data("motion-reference.json")
	check(not reference.is_empty(), "motion-reference.json manquant (cuisson)")
	if reference.is_empty():
		return
	var motion := MotionController.new()
	var worst := 0.0
	for i in reference.steps.size():
		var step: Dictionary = reference.steps[i]
		motion.update(step.dt, step.x, step.z, { "sprint": step.sprint, "analog": step.analog, "drive": step.drive })
		var expected: Array = reference.states[i]
		var got := [motion.x, motion.z, motion.heading, motion.speed, motion.run_blend, motion.sprint, motion.saber, motion.turn_rate, motion.forward_accel]
		for k in got.size():
			worst = maxf(worst, absf(got[k] - expected[k]))
	check(worst < 1e-3, "écart maximal %f" % worst)


func test_stick_tilt_paces_from_a_slow_walk_to_a_sprint() -> void:
	near(MotionController.speed_for_tilt(0.0), 0.0, 1e-6, "au repos")
	near(MotionController.speed_for_tilt(0.25), 1.15, 1e-6, "marche lente")
	near(MotionController.speed_for_tilt(1.0), MotionController.SPRINT_SPEED, 1e-6, "à fond")
	check(MotionController.speed_for_tilt(0.7) > MotionController.WALK_SPEED, "plus vite en penchant plus")
