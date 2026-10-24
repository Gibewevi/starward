extends TestCase
## The squad's minds (scripts/ai/squad_mind.gd) against src/trooper-ai.js:
## five men at their posts in the lab; the hero walks in, is seen, fought from
## the open, hides behind a crate, is lost and searched for. The same moods
## and tactics, at the same moments, the men where the web's are, the same
## shots and radio calls. And the escort's rounds through the room.
## Godot keeps positions in single precision, the web in double: the men drift
## apart by a hair, until one of them makes another choice (a way round, a
## spot to fire from) and the two fights part. They must agree for SURE seconds.

## How far apart (m) the men may stand.
const APART := 0.3
## How long (s) the two squads must think and act alike, at least.
const SURE := 10.0


static func _v(values: Variant) -> Vector3:
	return Vector3(values[0], values[1], values[2])


static func _counter(draws: Array, start: int) -> Callable:
	var at := [start]
	return func() -> float:
		var value: float = draws[at[0] % draws.size()]
		at[0] += 1
		return value


static func _posts() -> Array:
	var posts := []
	for post in data("lab.json").posts:
		var entry := { "position": _v(post.position), "heading": post.heading }
		if post.has("route"):
			entry.route = post.route.map(func(point: Array) -> Vector3: return _v(point))
		posts.append(entry)
	return posts


func test_the_escort_rounds_match() -> void:
	var lab_data := data("lab.json")
	var lab := Obstacles.new(lab_data.obstacles)
	var rounds := SquadMind.patrol_rounds(lab, Nav.new(lab, lab_data.bounds), lab_data.bounds)
	var want: Array = data("nav-reference.json").rounds
	check(rounds.size() == want.size(), "%d rondes au lieu de %d" % [rounds.size(), want.size()])
	for k in mini(rounds.size(), want.size()):
		check(rounds[k].size() == want[k].size(), "ronde %d : %d points au lieu de %d" % [k, rounds[k].size(), want[k].size()])
		for m in mini(rounds[k].size(), want[k].size()):
			check((rounds[k][m] as Vector3).distance_to(_v(want[k][m])) < 1e-4, "ronde %d, point %d" % [k, m])


func test_replays_the_javascript_squad() -> void:
	var reference := data("squad-reference.json")
	check(not reference.is_empty(), "squad-reference.json manquant")
	if reference.is_empty():
		return
	var draws: Array = data("combat-reference.json").draws
	var lab_data := data("lab.json")
	var lab := Obstacles.new(lab_data.obstacles)
	var nav := Nav.new(lab, lab_data.bounds)
	var posts := _posts()
	var troopers := []
	var stage := Node3D.new()
	tree.root.add_child(stage)
	for index in posts.size():
		var trooper := Stormtrooper.new(posts[index].position, posts[index].heading, _counter(draws, index * int(reference.draws.troopers)), lab)
		stage.add_child(trooper)
		troopers.append(trooper)
	var squad := SquadMind.new(troopers, lab, nav, null, posts, _counter(draws, int(reference.draws.squad)), Vector3(10, 0, -8).normalized())
	var frames: Array = reference.frames
	var frame := 0
	var shots := []
	var cues := []
	var first := -1
	var reason := ""
	var worst := 0.0
	for i in reference.steps.size():
		var step: Dictionary = reference.steps[i]
		var hero := _v(step.hero)
		var noises := []
		for noise in step.noises:
			noises.append({ "position": _v(noise.position), "radius": noise.radius, "from": _v(noise.from), "strength": noise.strength, "alarm": noise.alarm, "source": troopers[int(noise.source)] if noise.source >= 0 else null })
		var thoughts := squad.update(step.dt, hero, _v(step.velocity), step.saber, noises)
		for shot in thoughts.shots:
			shots.append(troopers.find(shot.trooper))
		for cue in thoughts.cues:
			cues.append("%s%s:%d" % [cue.type, ":" + cue.radio if cue.has("radio") else "", troopers.find(cue.trooper)])
		for trooper: Stormtrooper in troopers:
			trooper.focus = hero
			trooper.update(step.dt, step.time)
		Stormtrooper.collide_squad(troopers)
		if frame >= frames.size() or int(frames[frame].step) != i:
			continue
		var expected: Dictionary = frames[frame]
		frame += 1
		if first >= 0:
			continue
		for k in squad.minds.size():
			var mind: Dictionary = squad.minds[k]
			var want: Dictionary = expected.minds[k]
			var t: Stormtrooper = mind.trooper
			var apart := t.root.position.distance_to(_v(want.at))
			worst = maxf(worst, apart)
			var differs := ""
			if mind.mode != want.mode:
				differs = "mode %s au lieu de %s" % [mind.mode, want.mode]
			elif mind.tactic != want.tactic:
				differs = "tactique %s au lieu de %s" % [mind.tactic, want.tactic]
			elif mind.role != want.role:
				differs = "rôle %s au lieu de %s" % [mind.role, want.role]
			elif t.state() != want.state:
				differs = "état %s au lieu de %s" % [t.state(), want.state]
			elif apart > APART:
				differs = "à %.3f m de sa place" % apart
			if not differs.is_empty() and first < 0:
				first = i
				reason = "homme %d : %s" % [k, differs]
		var expected_shots: Array = expected.shots.map(func(index: float) -> int: return int(index))
		if first < 0 and (shots != expected_shots or cues != expected.cues):
			first = i
			reason = "tirs %s / radio %s au lieu de %s / %s" % [shots, cues, expected.shots, expected.cues]
		shots = []
		cues = []
	stage.queue_free()
	var seconds: float = reference.steps[first].time if first >= 0 else reference.steps[-1].time
	print("    escouade : identique jusqu’à %.1f s%s ; hommes à ≤ %.3f m" % [seconds, " (%s)" % reason if first >= 0 else "", worst])
	check(frame == frames.size(), "%d images comparées sur %d" % [frame, frames.size()])
	check(first < 0 or seconds >= SURE, "l’escouade diverge à %.1f s : %s" % [seconds, reason])
