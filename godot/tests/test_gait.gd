extends TestCase
## A trooper's gait (scripts/trooper/trooper_gait.gd) against src/trooper-gait.js:
## a scripted walk, run with the legs twisted, turn on the spot, backing away —
## the same joint rotations, hips and ground.


func test_replays_the_javascript_gait() -> void:
	var reference := data("gait-reference.json")
	check(not reference.is_empty(), "gait-reference.json manquant")
	if reference.is_empty():
		return
	var gait := TrooperGait.new(reference.legLength, reference.offset)
	var frames: Array = reference.frames
	var frame := 0
	var worst := 0.0
	var worst_hips := 0.0
	for i in reference.steps.size():
		var step: Dictionary = reference.steps[i]
		gait.update(step.dt, step.speed, step.backward, step.turnRate)
		gait.twist(step.twist)
		if frame >= frames.size() or int(frames[frame].step) != i:
			continue
		var expected: Dictionary = frames[frame]
		for k in reference.joints.size():
			var q: Array = expected.rotations[k]
			var want := Quaternion(q[0], q[1], q[2], q[3]).normalized()
			var got: Quaternion = (gait.rotations[reference.joints[k]] as Quaternion).normalized()
			worst = maxf(worst, 1.0 - absf(got.dot(want)))
		worst_hips = maxf(worst_hips, gait.hips.distance_to(Vector3(expected.hips[0], expected.hips[1], expected.hips[2])))
		near(gait.ground(), expected.ground, 1e-4, "sol au pas %d" % i)
		near(gait.state.phase, expected.phase, 1e-4, "phase au pas %d" % i)
		frame += 1
	check(frame == frames.size(), "%d images comparées sur %d" % [frame, frames.size()])
	check(worst < 1e-6, "rotations : écart %.8f" % worst)
	check(worst_hips < 1e-4, "bassin : écart %.6f m" % worst_hips)
