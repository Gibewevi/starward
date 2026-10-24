extends TestCase
## The ragdoll alone (scripts/trooper/ragdoll.gd) against src/ragdoll.js: a
## trooper's particles, bodies and joint ranges, thrown against a crate, a
## shoulder cut, the arm shoved again — every particle where the web's lands.


static func _dt(i: int) -> float:
	return 0.0311 if i % 7 == 0 else 0.0163


func test_replays_the_javascript_throw() -> void:
	var reference := data("ragdoll-reference.json")
	check(not reference.is_empty(), "ragdoll-reference.json manquant")
	if reference.is_empty():
		return
	var layout: Dictionary = reference.layout
	var ragdoll := Ragdoll.new()
	for p in layout.particles:
		ragdoll.add_particle_at(p.position[0], p.position[1], p.position[2], p.radius, p.mass, p.name)
	for body in layout.bodies:
		ragdoll.add_body(body.name, PackedInt32Array(body.indices))
	for limit in layout.limits:
		ragdoll.add_limit(int(limit.a), int(limit.b), limit.min, INF if limit.max < 0 else limit.max, limit.tag if limit.tag != null else "")
	for pair in layout.adjacent:
		ragdoll.connect_bodies(ragdoll.bodies[int(pair[0])], ragdoll.bodies[int(pair[1])])
	ragdoll.obstacles = Obstacles.new(layout.boxes.map(func(box: Dictionary) -> Dictionary: return { "kind": "crate", "min": box.min, "max": box.max }))
	var sever: Dictionary = reference.sever
	var arm: Array = []
	for name in sever.bodies:
		for body in ragdoll.bodies:
			if body.name == name:
				arm.append(body)
	ragdoll.release(ragdoll.bodies)
	var everyone := PackedInt32Array(range(ragdoll.count()))
	var frames: Array = reference.frames
	var frame := 0
	var worst := 0.0
	for i in 240:
		if i == 0:
			ragdoll.push_xyz(everyone, 1.2, 2.6, -3.1)
			for index in ragdoll.count():
				if index % 5 == 0:
					ragdoll.set_surface(index, 0.05, 0.38)
		if i == int(sever.at):
			ragdoll.sever(int(sever.particle), arm, sever.tag)
		if i == 100:
			var indices := PackedInt32Array()
			for body in arm:
				indices.append_array(body.indices)
			ragdoll.push_xyz(indices, -2, 3, 1)
		ragdoll.step(_dt(i))
		if frame < frames.size() and int(frames[frame].step) == i:
			var positions: Array = frames[frame].positions
			check(positions.size() == ragdoll.count(), "pas %d : %d particules au lieu de %d" % [i, ragdoll.count(), positions.size()])
			for k in mini(positions.size(), ragdoll.count()):
				var expected := Vector3(positions[k][0], positions[k][1], positions[k][2])
				worst = maxf(worst, ragdoll.position(k).distance_to(expected))
			frame += 1
	check(frame == frames.size(), "%d images comparées sur %d" % [frame, frames.size()])
	check(worst < 2e-4, "écart maximal %.6f m" % worst)
