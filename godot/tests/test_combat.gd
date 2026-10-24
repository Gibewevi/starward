extends TestCase
## The combat controller's port against the JavaScript: a scripted fight —
## the draw flourish, a combo closed by a finisher, the guard, parries, both
## Force powers and a hold, the twirl, a running opener, blows aside and
## behind, deflections, the impale and the plunge — must give the same moves,
## at the same moments, with the same poses, step after step.

func _controller(reference: Dictionary) -> CombatController:
	var draws: Array = reference.draws
	var count := [0]
	var draw := func() -> float:
		var value: float = draws[count[0] % draws.size()]
		count[0] += 1
		return value
	return CombatController.new(draw)


func _play(combat: CombatController, method: String, argument: Variant) -> bool:
	match method:
		"attack":
			return combat.attack(argument.speed, argument.aim) if argument.has("aim") else combat.attack(argument.speed)
		"power":
			return combat.power(argument)
		"deflect":
			return combat.deflect(argument)
		_:
			return combat.call(method)


func _vector_gap(a: Vector3, b: Array) -> float:
	return a.distance_to(Vector3(b[0], b[1], b[2]))


func test_the_moves_are_baked() -> void:
	var combat := CombatController.new()
	check(combat.moves.size() >= 20, "les coups (%d)" % combat.moves.size())
	check(combat.moves.has("slash") and combat.moves.has("forcePush") and combat.moves.has("draw"), "taille, poussée, dégainé")


func test_replays_the_javascript_fight() -> void:
	var reference := data("combat-reference.json")
	var combat := _controller(reference)
	var worst := 0.0
	var worst_at := -1
	var mismatches: Array = []
	for i in reference.steps.size():
		var results: Array = []
		for entry in reference.script.get(str(i), []):
			results.append(_play(combat, entry[0], entry[1] if entry.size() > 1 else null))
		var step: Dictionary = reference.steps[i]
		var options := { "guard": step.guard, "speed": step.speed, "hold": step.hold, "charging": step.charging, "lead": step.lead }
		if step.has("aim"):
			options.aim = step.aim
		var out := combat.update(step.dt, options)
		var expected: Dictionary = reference.states[i]
		var started = combat.take_start()
		var fired = combat.take_force()
		if mismatches.size() < 6:
			if results != expected.results:
				mismatches.append("pas %d : réponses %s au lieu de %s" % [i, results, expected.results])
			if started != expected.started or fired != expected.fired or out.name != expected.name:
				mismatches.append("pas %d : %s/%s/%s au lieu de %s/%s/%s" % [i, started, fired, out.name, expected.started, expected.fired, expected.name])
			if combat.hits != int(expected.hits) or combat.sequence != int(expected.sequence) or out.engaged != expected.engaged:
				mismatches.append("pas %d : coups %d, séquence %d" % [i, combat.hits, combat.sequence])
		var gap := maxf(_vector_gap(out.hand, expected.hand), maxf(_vector_gap(out.blade, expected.blade), _vector_gap(out.left, expected.left)))
		for key in ["grip", "yaw", "pitch", "crouch", "weight", "lift", "guard", "spin", "drive", "trail", "flare", "shake"]:
			gap = maxf(gap, absf(float(out[key]) - float(expected[key])))
		gap = maxf(gap, absf(out.input_scale - float(expected.inputScale)) + absf(out.turn_scale - float(expected.turnScale)))
		gap = maxf(gap, absf((-1.0 if is_inf(out.max_speed) else out.max_speed) - float(expected.maxSpeed)))
		if gap > worst:
			worst = gap
			worst_at = i
	for mismatch in mismatches:
		check(false, mismatch)
	check(worst < 1e-3, "écart de pose %f (pas %d)" % [worst, worst_at])
